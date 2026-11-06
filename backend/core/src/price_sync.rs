//! Per-connection price-fetch pass. Runs after `ingest()`. Reads the resolved
//! symbol from `meta` (resolving + caching on first sight), re-fetches a
//! trailing window ending at today, and upserts price rows. Every per-
//! instrument error is non-fatal: it's logged and the pass continues.

use chrono::Duration;
use uuid::Uuid;

use crate::error::CoreError;
use crate::provider::PriceProvider;
use crate::repo::instrument::{InstrumentRow, ensure_cash, mark_unresolved, set_symbol};
use crate::repo::price::{has_fx_rate, insert_prices, latest_price_ts, market_today};

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

#[derive(Debug, Default, PartialEq, Eq)]
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
    let currencies = sqlx::query_scalar!(
        r#"select cur as "cur!" from connection_fx_currencies($1) cur"#,
        connection_id,
    )
    .fetch_all(&mut *conn)
    .await?;
    for currency in currencies {
        ensure_cash(conn, &currency).await?;
    }
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
    let mut conn = pool.acquire().await?;
    for row in instruments {
        fetch_instrument(&mut conn, providers, &row, &mut summary).await?;
    }

    Ok(summary)
}

/// Distinct non-cash instruments held (nonzero quantity) under a connection,
/// plus the cash instrument (the FX rate) for every currency this connection
/// needs a rate for, excluding the pivot (`connection_fx_currencies`, which
/// says why each one is needed).
///
/// Drives the per-connection price-fetch pass.
pub async fn price_eligible_instruments_for_connection(
    pool: &sqlx::PgPool,
    connection_id: Uuid,
) -> Result<Vec<InstrumentRow>, CoreError> {
    let rows = sqlx::query_as!(
        InstrumentRow,
        r#"
        select distinct
               i.id       as "id!",
               i.kind     as "kind!",
               i.symbol,
               i.isin,
               i.name     as "name!",
               i.currency as "currency!",
               i.meta     as "meta!"
        from holding h
        join account a    on a.id = h.account_id
        join instrument i on i.id = h.instrument_id
        where a.connection_id = $1
          and i.kind <> 'cash'
          and h.quantity <> 0

        union

        -- Foreign cash is eligible: its "price" is the FX rate. Cash in the
        -- pivot is 1 by definition and has no Yahoo pair.
        select fx.id       as "id!",
               fx.kind     as "kind!",
               fx.symbol,
               fx.isin,
               fx.name     as "name!",
               fx.currency as "currency!",
               fx.meta     as "meta!"
        from connection_fx_currencies($1) cur
        join instrument fx on fx.kind = 'cash' and fx.currency = cur

        order by 5
        "#,
        connection_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Makes sure a rate into `currency` is stored, fetching it now rather than at
/// the next sync. For a reader switching their currency: their figures are
/// converted at read time, and with no rate they are left out. True when a
/// rate is stored afterwards (the pivot needs none); a provider failure is
/// logged and reads as false, so the caller decides.
pub async fn ensure_fx_rate(
    pool: &sqlx::PgPool,
    providers: &[Box<dyn PriceProvider>],
    currency: &str,
) -> Result<bool, CoreError> {
    if currency == crate::repo::settings::base_currency(pool).await? {
        return Ok(true);
    }
    let mut conn = pool.acquire().await?;
    let row = ensure_cash(&mut conn, currency).await?;
    let mut summary = PriceSyncSummary::default();
    fetch_instrument(&mut conn, providers, &row, &mut summary).await?;
    has_fx_rate(&mut *conn, currency).await
}

/// One instrument's pass: resolve its symbol (cached), then fetch and upsert
/// its trailing window. Provider failures are logged and counted, never
/// returned; only database errors are.
async fn fetch_instrument(
    conn: &mut sqlx::PgConnection,
    providers: &[Box<dyn PriceProvider>],
    row: &InstrumentRow,
    summary: &mut PriceSyncSummary,
) -> Result<(), CoreError> {
    let iref = row.instrument_ref();

    let Some(provider) = providers.iter().find(|p| p.supports(&iref)) else {
        return Ok(());
    };

    // Freshness guard: already have today's point → nothing to do.
    let latest = latest_price_ts(conn, row.id).await?;
    if latest.map(|ts| ts.date_naive()) == Some(market_today()) {
        summary.skipped_fresh += 1;
        return Ok(());
    }

    // Resolve (or reuse cached) symbol.
    let symbol = match row.provider_symbol(provider.key()) {
        Some(s) => s.to_string(),
        None => {
            if row.unresolved_by(provider.key()) {
                return Ok(());
            }
            match provider.resolve_symbol(&iref).await {
                Ok(Some(s)) => {
                    set_symbol(conn, row.id, provider.key(), &s).await?;
                    summary.resolved += 1;
                    s
                }
                Ok(None) => {
                    mark_unresolved(conn, row.id, provider.key()).await?;
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
