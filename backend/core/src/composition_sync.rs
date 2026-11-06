//! Per-connection ETF-composition pass. Runs after `price_sync`. Reads the
//! provider's cached symbol from `meta` (resolving on first sight), scrapes the
//! composition, and stores it. Best-effort: every per-instrument error is
//! logged and the pass continues. Composition changes slowly, so the
//! eligibility query already excludes rows fresher than 30 days.

use uuid::Uuid;

use crate::error::CoreError;
use crate::provider::CompositionProvider;
use crate::repo::instrument::{InstrumentRow, mark_composition_none, set_composition, set_symbol};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct CompositionSyncSummary {
    pub resolved: usize,
    pub fetched: usize,
    pub unresolved: usize,
    /// Listings whose composition fetch failed.
    pub failed: usize,
}

pub async fn fetch_composition_for_connection(
    pool: &sqlx::PgPool,
    connection_id: Uuid,
    provider: &dyn CompositionProvider,
) -> Result<CompositionSyncSummary, CoreError> {
    let mut summary = CompositionSyncSummary::default();
    let instruments = composition_eligible_instruments_for_connection(pool, connection_id).await?;
    let mut conn = pool.acquire().await?;

    for row in instruments {
        let iref = row.instrument_ref();

        // Resolve (or reuse cached) symbol.
        let symbol = match row.provider_symbol(provider.key()) {
            Some(s) => s.to_string(),
            None => match provider.resolve_symbol(&iref).await {
                Ok(Some(s)) => {
                    set_symbol(&mut conn, row.id, provider.key(), &s).await?;
                    summary.resolved += 1;
                    s
                }
                Ok(None) => {
                    mark_composition_none(&mut conn, row.id).await?;
                    summary.unresolved += 1;
                    continue;
                }
                Err(e) => {
                    tracing::warn!(
                        provider = provider.key(),
                        instrument_id = %row.id,
                        error = %crate::logs::error_chain(&e),
                        "composition resolve failed"
                    );
                    summary.failed += 1;
                    continue;
                }
            },
        };

        match provider.fetch_composition(&symbol).await {
            // A resolved symbol whose page has no breakdown (an equity, or a
            // tracker that reports none) must NOT be stamped `etf` with empty
            // data — mark it `none` so it's excluded from future passes.
            Ok(comp) if comp.countries.is_empty() && comp.sectors.is_empty() => {
                mark_composition_none(&mut conn, row.id).await?;
                summary.unresolved += 1;
            }
            Ok(comp) => {
                set_composition(&mut conn, row.id, &comp).await?;
                summary.fetched += 1;
            }
            // ponytail: a cached symbol that errors on fetch every sync is re-tried forever (one
            // request/sync). Mirrors price_sync's transient-error handling; add a
            // meta.composition_attempted_at backoff if this becomes costly.
            Err(e) => {
                tracing::warn!(
                    provider = provider.key(),
                    instrument_id = %row.id,
                    error = %crate::logs::error_chain(&e),
                    "composition fetch failed"
                );
                summary.failed += 1;
            }
        }
    }

    Ok(summary)
}

/// Instruments worth a composition scrape: non-cash, holds a symbol/isin, not
/// already marked "none", and composition missing or older than 30 days.
pub async fn composition_eligible_instruments_for_connection(
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
          and (i.symbol is not null or i.isin is not null)
          and coalesce(i.meta->>'composition_status', '') <> 'none'
          and (
            i.meta->'composition'->>'as_of' is null
            or (i.meta->'composition'->>'as_of')::date < (now() at time zone 'utc')::date - 30
          )
        order by i.name
        "#,
        connection_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
