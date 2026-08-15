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
    /// Points dropped because Yahoo reported no currency for the listing at all,
    /// so there is nothing to convert them from.
    pub skipped_unlabelled: usize,
}

// An FX rate can only be stored against a cash instrument, and cash instruments
// otherwise only appear when a user actually holds cash in that currency. Every
// currency this connection *converts through* therefore needs one backfilled,
// or fx_asof() stays NULL for it forever and whatever it governs reads zero:
//
// * instrument.currency — a USD equity in a EUR account never holds USD cash.
// * price.currency (the price domain) — Powens labels an instrument EUR, Yahoo
//   resolves a London listing quoted GBP; unit_value_asof reads the price row's
//   currency, so without GBP the position is unvaluable.
// * account.currency (the amount domain) — cost_basis and snapshot.value
//   convert from it.
//
// The `^[A-Z]{3}$` guard keeps a provider's stray `"usd"` (or worse) from
// becoming a second, globally-shared cash instrument that the
// `kind='cash'`-unique index on `currency` would not catch, and from being
// pasted into a live Yahoo URL. instrument rows are global/shared across users
// by design, so this is a plain insert, not a per-connection concept.
async fn ensure_cash_instruments_for_held_currencies(
    conn: &mut sqlx::PgConnection,
    connection_id: Uuid,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        insert into instrument (kind, symbol, isin, name, currency)
        select distinct 'cash', null, null, needed.cur, needed.cur
        from (
            select i.currency as cur
            from holding h
            join account a    on a.id = h.account_id
            join instrument i on i.id = h.instrument_id
            where a.connection_id = $1 and h.quantity <> 0

            union

            select p.currency
            from holding h
            join account a on a.id = h.account_id
            join price p   on p.instrument_id = h.instrument_id
            where a.connection_id = $1 and h.quantity <> 0

            union

            select a.currency
            from account a
            where a.connection_id = $1
        ) needed
        where needed.cur <> (select base_currency from app_settings where id = 1)
          and needed.cur ~ '^[A-Z]{3}$'
        on conflict (currency) where kind = 'cash' do nothing
        "#,
        connection_id,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

pub async fn fetch_prices_for_connection(
    pool: &sqlx::PgPool,
    connection_id: Uuid,
    providers: &[Box<dyn PriceProvider>],
) -> Result<PriceSyncSummary, CoreError> {
    let mut summary = PriceSyncSummary::default();
    {
        let mut conn = pool.acquire().await?;
        ensure_cash_instruments_for_held_currencies(&mut conn, connection_id).await?;
    }
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
                // Store points in whatever currency the listing is quoted in;
                // unit_value_asof converts at read time from the price row's own
                // currency. One Yahoo response is one listing, hence one
                // currency. A point with no currency at all is unconvertible, so
                // the batch is dropped rather than silently mislabelled.
                let currency = points
                    .first()
                    .map(|p| p.currency.clone())
                    .unwrap_or_default();
                if currency.is_empty() {
                    summary.skipped_unlabelled += points.len();
                    continue;
                }
                let batch: Vec<(chrono::DateTime<chrono::Utc>, rust_decimal::Decimal)> =
                    points.iter().map(|p| (p.ts, p.unit_price)).collect();
                // One batched upsert per instrument (a backfill can be hundreds of
                // bars) instead of a round-trip per point.
                let written = insert_prices(&mut conn, row.id, &batch, &currency).await?;
                summary.prices_inserted += written as usize;
            }
            Err(e) => {
                tracing::warn!("yahoo fetch failed for {symbol}: {e}");
            }
        }
    }

    Ok(summary)
}
