//! Per-connection ETF-composition pass. Runs after `price_sync`. Reads the
//! cached Boursorama symbol from `meta` (resolving on first sight), scrapes the
//! composition, and stores it. Best-effort: every per-instrument error is
//! logged and the pass continues. Composition changes slowly, so the
//! eligibility query already excludes rows fresher than 30 days.

use uuid::Uuid;

use crate::dto::InstrumentRef;
use crate::error::CoreError;
use crate::provider::CompositionProvider;
use crate::repo::instrument::{mark_composition_none, set_boursorama_symbol, set_composition};
use crate::repo::query::composition_eligible_instruments_for_connection;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct CompositionSyncSummary {
    pub resolved: usize,
    pub fetched: usize,
    pub unresolved: usize,
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
        let iref = InstrumentRef {
            kind: row.kind.clone(),
            symbol: row.symbol.clone(),
            isin: row.isin.clone(),
            name: row.name.clone(),
            currency: row.currency.clone(),
        };

        // Resolve (or reuse cached) symbol.
        let symbol = match row.meta.get("boursorama_symbol").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => match provider.resolve_symbol(&iref).await {
                Ok(Some(s)) => {
                    set_boursorama_symbol(&mut conn, row.id, &s).await?;
                    summary.resolved += 1;
                    s
                }
                Ok(None) => {
                    mark_composition_none(&mut conn, row.id).await?;
                    summary.unresolved += 1;
                    continue;
                }
                Err(e) => {
                    tracing::warn!("boursorama resolve failed for {}: {e}", row.name);
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
            Err(e) => tracing::warn!("boursorama fetch failed for {symbol}: {e}"),
        }
    }

    Ok(summary)
}
