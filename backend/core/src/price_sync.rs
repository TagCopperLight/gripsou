//! Per-connection price-fetch pass. Runs after `ingest()`. Reads the resolved
//! symbol from `meta` (resolving + caching on first sight), re-fetches a
//! trailing window ending at today, and upserts price rows. Every per-
//! instrument error is non-fatal: it's logged and the pass continues.

use chrono::Duration;
use uuid::Uuid;

use crate::dto::InstrumentRef;
use crate::error::CoreError;
use crate::provider::PriceProvider;
use crate::repo::instrument::{mark_symbol_unresolved, set_resolved_symbol};
use crate::repo::price::{insert_prices, latest_price_ts};
use crate::repo::query::{PriceEligibleInstrument, price_eligible_instruments_for_connection};

/// How far back of already-stored history each pass re-requests.
///
/// Asking Yahoo for strictly-newer-than-`max(ts)` looked like the obvious
/// saving and was the bug behind permanently missing days: the tail of Yahoo's
/// daily series is its least stable part, and a bar absent from the one
/// response whose window covered it could never be asked for again — the next
/// request already began after it. Two instances polling at the same instant
/// got different responses and forked, permanently.
///
/// Re-asking for a trailing window makes a dropped bar self-heal on the next
/// pass, and `insert_prices` is an upsert, so a bar we already have costs
/// nothing to see again. It is also the same single HTTP request either way —
/// the window only widens the response, not the round trips.
///
/// 30 days rather than a handful so a gap survives a week of failed syncs, a
/// holiday, or a laptop that was closed.
const REFETCH_DAYS: i64 = 30;

#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct PriceSyncSummary {
    pub resolved: usize,
    pub prices_inserted: usize,
    pub skipped_fresh: usize,
    pub unresolved: usize,
    /// Points dropped because Yahoo reported no currency for the listing at all,
    /// so there is nothing to convert them from.
    pub skipped_unlabelled: usize,
    /// Listings whose fetch failed.
    pub failed: usize,
}

// An FX rate can only be stored against a cash instrument, and cash instruments
// otherwise only appear when a user actually holds cash in that currency. So
// every currency this connection converts through gets one (instrument rows are
// global, shared across users).
async fn ensure_cash_instruments_for_held_currencies(
    conn: &mut sqlx::PgConnection,
    connection_id: Uuid,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        insert into instrument (kind, symbol, isin, name, currency)
        select 'cash', null, null, cur, cur
        from connection_fx_currencies($1) cur
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
    fetch_prices_for_connection_at(
        pool,
        connection_id,
        providers,
        chrono::Utc::now().date_naive(),
    )
    .await
}

/// Runs the routine pass for an explicit business date. Production callers use UTC today.
pub async fn fetch_prices_for_connection_at(
    pool: &sqlx::PgPool,
    connection_id: Uuid,
    providers: &[Box<dyn PriceProvider>],
    today: chrono::NaiveDate,
) -> Result<PriceSyncSummary, CoreError> {
    let mut summary = PriceSyncSummary::default();
    {
        let mut conn = pool.acquire().await?;
        ensure_cash_instruments_for_held_currencies(&mut conn, connection_id).await?;
    }
    let instruments = price_eligible_instruments_for_connection(pool, connection_id).await?;
    let mut conn = pool.acquire().await?;
    for row in instruments {
        fetch_instrument(&mut conn, providers, &row, today, &mut summary).await?;
    }

    Ok(summary)
}

/// Makes sure a rate into `currency` is stored, fetching it now rather than at
/// the next sync. For a reader switching their currency: their figures are
/// converted at read time, and with no rate they could only be shown in the
/// pivot. True when a rate is stored afterwards (the pivot needs none); a
/// provider failure is logged and reads as false, so the caller decides.
pub async fn ensure_fx_rate(
    pool: &sqlx::PgPool,
    providers: &[Box<dyn PriceProvider>],
    currency: &str,
    today: chrono::NaiveDate,
) -> Result<bool, CoreError> {
    if currency == crate::repo::settings::base_currency(pool).await? {
        return Ok(true);
    }
    let mut conn = pool.acquire().await?;
    let row = sqlx::query_as!(
        PriceEligibleInstrument,
        r#"
        with ins as (
            insert into instrument (kind, symbol, isin, name, currency)
            values ('cash', null, null, $1, $1)
            on conflict (currency) where kind = 'cash' do nothing
            returning id, kind, symbol, isin, name, currency, meta
        )
        select id as "id!", kind as "kind!", symbol, isin, name as "name!",
               currency as "currency!", meta as "meta!"
        from ins
        union all
        select id, kind, symbol, isin, name, currency, meta
        from instrument where kind = 'cash' and currency = $1
        "#,
        currency,
    )
    .fetch_one(&mut *conn)
    .await?;
    let mut summary = PriceSyncSummary::default();
    fetch_instrument(&mut conn, providers, &row, today, &mut summary).await?;
    Ok(latest_price_ts(&mut conn, row.id).await?.is_some())
}

/// One instrument's pass: resolve its symbol (cached), then fetch and upsert
/// its trailing window. Provider failures are logged and counted, never
/// returned; only database errors are.
async fn fetch_instrument(
    conn: &mut sqlx::PgConnection,
    providers: &[Box<dyn PriceProvider>],
    row: &PriceEligibleInstrument,
    today: chrono::NaiveDate,
    summary: &mut PriceSyncSummary,
) -> Result<(), CoreError> {
    let iref = InstrumentRef {
        kind: row.kind.clone(),
        symbol: row.symbol.clone(),
        isin: row.isin.clone(),
        name: row.name.clone(),
        currency: row.currency.clone(),
    };

    let Some(provider) = providers.iter().find(|p| p.supports(&iref)) else {
        return Ok(());
    };

    // Freshness guard: already have today's point → nothing to do.
    let latest = latest_price_ts(conn, row.id).await?;
    if latest.map(|ts| ts.date_naive()) == Some(today) {
        summary.skipped_fresh += 1;
        return Ok(());
    }

    // Resolve (or reuse cached) symbol.
    let symbol = match row.meta.get("yahoo_symbol").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => {
            if row.meta.get("yahoo_resolution").and_then(|v| v.as_str()) == Some("unresolved") {
                return Ok(());
            }
            match provider.resolve_symbol(&iref).await {
                Ok(Some(s)) => {
                    set_resolved_symbol(conn, row.id, &s).await?;
                    summary.resolved += 1;
                    s
                }
                Ok(None) => {
                    mark_symbol_unresolved(conn, row.id).await?;
                    summary.unresolved += 1;
                    return Ok(());
                }
                Err(e) => {
                    tracing::warn!(
                        provider = provider.key(),
                        instrument_id = %row.id,
                        error = %crate::logs::error_chain(&e),
                        "price resolve failed"
                    );
                    summary.failed += 1;
                    return Ok(());
                }
            }
        }
    };

    // Re-fetch the trailing window (or full history when no prices yet)
    // and upsert. `latest` itself is deliberately not the start: see
    // REFETCH_DAYS.
    let since = latest.map(|ts| ts - Duration::days(REFETCH_DAYS));
    match provider.fetch_prices(&symbol, since).await {
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
                tracing::warn!(
                    provider = provider.key(),
                    instrument_id = %row.id,
                    symbol = %symbol,
                    points = points.len() as u64,
                    "prices dropped: listing has no currency"
                );
                summary.skipped_unlabelled += points.len();
                return Ok(());
            }
            let batch: Vec<(chrono::DateTime<chrono::Utc>, rust_decimal::Decimal)> =
                points.iter().map(|p| (p.ts, p.unit_price)).collect();
            // One batched upsert per instrument (a backfill can be hundreds of
            // bars) instead of a round-trip per point.
            let written = insert_prices(conn, row.id, &batch, &currency).await?;
            summary.prices_inserted += written as usize;
        }
        Err(e) => {
            tracing::warn!(
                provider = provider.key(),
                instrument_id = %row.id,
                error = %crate::logs::error_chain(&e),
                "price fetch failed"
            );
            summary.failed += 1;
        }
    }
    Ok(())
}
