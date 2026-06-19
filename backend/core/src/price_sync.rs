//! Per-connection price-fetch pass. Runs after `ingest()`. Reads the resolved
//! symbol from `meta` (resolving + caching on first sight), fetches only the
//! delta since the last stored point, and upserts price rows. Every per-
//! instrument error is non-fatal: it's logged and the pass continues.

use uuid::Uuid;

use crate::dto::InstrumentRef;
use crate::error::CoreError;
use crate::provider::PriceProvider;
use crate::repo::instrument::{mark_symbol_unresolved, set_resolved_symbol};
use crate::repo::price::{insert_prices, latest_price_ts};
use crate::repo::query::price_eligible_instruments_for_connection;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct PriceSyncSummary {
    pub resolved: usize,
    pub prices_inserted: usize,
    pub skipped_fresh: usize,
    pub unresolved: usize,
    /// Points dropped because the price currency differed from the instrument's
    /// (multi-currency is a non-goal; see the currency guard below).
    pub skipped_currency: usize,
}

pub async fn fetch_prices_for_connection(
    pool: &sqlx::PgPool,
    connection_id: Uuid,
    providers: &[Box<dyn PriceProvider>],
) -> Result<PriceSyncSummary, CoreError> {
    let mut summary = PriceSyncSummary::default();
    let instruments = price_eligible_instruments_for_connection(pool, connection_id).await?;
    let today = chrono::Utc::now().date_naive();
    let mut conn = pool.acquire().await?;

    for row in instruments {
        let iref = InstrumentRef {
            kind: row.kind.clone(),
            symbol: row.symbol.clone(),
            isin: row.isin.clone(),
            name: row.name.clone(),
            currency: row.currency.clone(),
        };

        let Some(provider) = providers.iter().find(|p| p.supports(&iref)) else {
            continue;
        };

        // Freshness guard: already have today's point → nothing to do.
        let latest = latest_price_ts(&mut conn, row.id).await?;
        if latest.map(|ts| ts.date_naive()) == Some(today) {
            summary.skipped_fresh += 1;
            continue;
        }

        // Resolve (or reuse cached) symbol.
        let symbol = match row.meta.get("yahoo_symbol").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => {
                if row.meta.get("yahoo_resolution").and_then(|v| v.as_str()) == Some("unresolved") {
                    continue;
                }
                match provider.resolve_symbol(&iref).await {
                    Ok(Some(s)) => {
                        set_resolved_symbol(&mut conn, row.id, &s).await?;
                        summary.resolved += 1;
                        s
                    }
                    Ok(None) => {
                        mark_symbol_unresolved(&mut conn, row.id).await?;
                        summary.unresolved += 1;
                        continue;
                    }
                    Err(e) => {
                        tracing::warn!("yahoo resolve failed for {}: {e}", row.name);
                        continue;
                    }
                }
            }
        };

        // Fetch the delta (or full history when no prices yet) and upsert.
        match provider.fetch_prices(&symbol, latest).await {
            Ok(points) => {
                // Multi-currency is a non-goal: only store points quoted in the
                // instrument's own currency. A wrong-currency listing (or a point
                // whose currency we couldn't determine) is dropped so valuation
                // degrades to the provider valuation instead of summing, say, USD
                // into a EUR total at par.
                let mut batch: Vec<(chrono::DateTime<chrono::Utc>, rust_decimal::Decimal)> =
                    Vec::with_capacity(points.len());
                for p in points {
                    if p.currency != row.currency {
                        summary.skipped_currency += 1;
                        continue;
                    }
                    batch.push((p.ts, p.unit_price));
                }
                // One batched upsert per instrument (a backfill can be hundreds of
                // bars) instead of a round-trip per point.
                let written = insert_prices(&mut conn, row.id, &batch, &row.currency).await?;
                summary.prices_inserted += written as usize;
            }
            Err(e) => {
                tracing::warn!("yahoo fetch failed for {symbol}: {e}");
            }
        }
    }

    Ok(summary)
}
