//! Per-connection price-fetch pass, after `ingest()`. A per-instrument error is logged and the pass continues.

use chrono::Duration;
use uuid::Uuid;

use crate::error::CoreError;
use crate::provider::PriceProvider;
use crate::repo::instrument::{InstrumentRow, ensure_cash, mark_unresolved, set_symbol};
use crate::repo::price::{has_fx_rate, insert_prices, latest_price_ts, market_today};

/// How far back of stored history each pass re-requests.
///
/// Asking only for bars newer than `max(ts)` loses days for good: the tail of Yahoo's daily series is its
/// least stable part, and a bar missing from one response would never be asked for again. A trailing
/// window self-heals, and `insert_prices` is an upsert. 30 days so a gap survives a week of failed syncs.
const REFETCH_DAYS: i64 = 30;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct PriceSyncSummary {
    pub resolved: usize,
    pub prices_inserted: usize,
    pub skipped_fresh: usize,
    pub unresolved: usize,
    /// Dropped because Yahoo reported no currency for the listing.
    pub skipped_unlabelled: usize,
    pub failed: usize,
}

// An FX rate can only be stored against a cash instrument, which otherwise exists only when a user holds
// that currency, so every currency this connection converts through gets one.
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

/// Distinct non-cash instruments held under a connection, plus the cash instrument (the FX rate) for every
/// currency it needs a rate for, excluding the pivot (`connection_fx_currencies`).
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

        -- Foreign cash is eligible (its "price" is the FX rate); pivot cash is 1 and has no Yahoo pair.
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

/// Fetches the rate now rather than at the next sync, for a reader switching currency: with no rate their
/// figures are left out. True when a rate is stored afterwards (`pivot` needs none); a provider failure is
/// logged and reads as false.
pub async fn ensure_fx_rate(
    pool: &sqlx::PgPool,
    providers: &[Box<dyn PriceProvider>],
    pivot: &str,
    currency: &str,
) -> Result<bool, CoreError> {
    if currency == pivot {
        return Ok(true);
    }
    let mut conn = pool.acquire().await?;
    let row = ensure_cash(&mut conn, currency).await?;
    let mut summary = PriceSyncSummary::default();
    fetch_instrument(&mut conn, providers, &row, &mut summary).await?;
    has_fx_rate(&mut *conn, currency).await
}

/// Provider failures are logged and counted, never returned; only database errors are.
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

    let latest = latest_price_ts(conn, row.id).await?;
    if latest.map(|ts| ts.date_naive()) == Some(market_today()) {
        summary.skipped_fresh += 1;
        return Ok(());
    }

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

    // `latest` itself is deliberately not the start: see REFETCH_DAYS.
    let since = latest.map(|ts| ts - Duration::days(REFETCH_DAYS));
    match provider.fetch_prices(&symbol, since).await {
        Ok(points) => {
            // Points are stored in the listing's own currency (`unit_value_asof` converts at read time). A point with
            // no currency at all is unconvertible, so the batch is dropped rather than mislabelled.
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
