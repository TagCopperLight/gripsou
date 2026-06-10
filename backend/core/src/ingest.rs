//! Sync-ingestion orchestrator: persist a provider `SyncResult` for one
//! connection in a single transaction. Idempotent and atomic.

use std::collections::HashMap;

use chrono::Utc;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::dto::SyncResult;
use crate::error::CoreError;
use crate::repo::account::upsert_account;
use crate::repo::holding::upsert_holding;
use crate::repo::instrument::resolve_instrument;
use crate::repo::snapshot::stamp_snapshot;
use crate::repo::transaction::insert_transaction;

/// Counts of what an ingest wrote (handy for logging and tests).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct IngestSummary {
    pub accounts: usize,
    pub holdings: usize,
    pub transactions_inserted: usize,
    pub snapshots: usize,
}

pub async fn ingest(
    pool: &PgPool,
    connection_id: Uuid,
    sync: &SyncResult,
) -> Result<IngestSummary, CoreError> {
    let mut tx = pool.begin().await?;
    let today = Utc::now().date_naive();

    // Accounts first; map external_id -> account id for later lookups.
    let mut account_ids: HashMap<&str, Uuid> = HashMap::new();
    for acct in &sync.accounts {
        let id = upsert_account(&mut tx, connection_id, acct).await?;
        account_ids.insert(acct.external_id.as_str(), id);
    }

    // Holdings: resolve instrument, upsert holding, stamp today's snapshot.
    let mut snapshots = 0;
    for holding in &sync.holdings {
        let account_id = *account_ids
            .get(holding.account_external_id.as_str())
            .ok_or_else(|| CoreError::UnknownAccountRef {
                external_id: holding.account_external_id.clone(),
            })?;
        let instrument_id = resolve_instrument(&mut tx, &holding.instrument).await?;
        let holding_id = upsert_holding(&mut tx, account_id, instrument_id, holding).await?;

        let value = if holding.instrument.kind == "cash" {
            holding.quantity
        } else {
            holding.valuation.unwrap_or(Decimal::ZERO)
        };
        stamp_snapshot(
            &mut tx,
            holding_id,
            today,
            holding.quantity,
            value,
            holding.cost_basis,
        )
        .await?;
        snapshots += 1;
    }

    // Transactions: dedup on external_id.
    let mut transactions_inserted = 0;
    for txn in &sync.transactions {
        let account_id = *account_ids
            .get(txn.account_external_id.as_str())
            .ok_or_else(|| CoreError::UnknownAccountRef {
                external_id: txn.account_external_id.clone(),
            })?;
        if insert_transaction(&mut tx, account_id, txn).await? {
            transactions_inserted += 1;
        }
    }

    tx.commit().await?;

    Ok(IngestSummary {
        accounts: sync.accounts.len(),
        holdings: sync.holdings.len(),
        transactions_inserted,
        snapshots,
    })
}
