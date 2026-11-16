//! Sync-ingestion orchestrator: persists a provider `SyncResult` for one connection in a single transaction.

use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::dto::SyncResult;
use crate::error::CoreError;
use crate::repo::account::upsert_account;
use crate::repo::connection;
use crate::repo::holding::{ids_for_connection, upsert_holding, zero_holding};
use crate::repo::instrument::resolve_instrument;
use crate::repo::snapshot::stamp_snapshot;
use crate::repo::transaction::{TxnWrite, upsert_transaction};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct IngestSummary {
    pub accounts: usize,
    pub holdings: usize,
    pub transactions_inserted: usize,
    pub transactions_updated: usize,
    pub transactions_skipped: usize,
    pub snapshots: usize,
    pub holdings_closed: usize,
    pub backfill_rows: usize,
    /// Counted in pairs, not rows.
    pub transfers_paired: usize,
}

pub async fn ingest(
    pool: &PgPool,
    connection_id: Uuid,
    sync: &SyncResult,
) -> Result<IngestSummary, CoreError> {
    let mut tx = pool.begin().await?;

    // Serialises the user's whole ingest, not just pairing: the upserts already hold row locks when pairing
    // starts, so two connections syncing at once could lock in opposite orders (see `lock_user_writes`).
    let user_id = connection::user_id(&mut *tx, connection_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    let mut tx = crate::db::lock_user_writes(tx, user_id).await?;

    let today = crate::repo::prefs::today(&mut *tx, user_id).await?;

    let mut account_ids: HashMap<&str, Uuid> = HashMap::new();
    // Dated by when the provider last read the bank, so stale balances are not stamped today.
    let mut snapshot_day: HashMap<Uuid, NaiveDate> = HashMap::new();
    let mut account_currency: HashMap<Uuid, &str> = HashMap::new();
    for acct in &sync.accounts {
        let id = upsert_account(&mut tx, connection_id, acct).await?;
        account_ids.insert(acct.external_id.as_str(), id);
        let day = acct.balance_as_of.map_or(today, |d| d.min(today));
        snapshot_day.insert(id, day);
        account_currency.insert(id, acct.currency.as_str());
    }

    let mut snapshots = 0;
    let mut present: HashSet<Uuid> = HashSet::new();
    for holding in &sync.holdings {
        let account_id = *account_ids
            .get(holding.account_external_id.as_str())
            .ok_or_else(|| CoreError::UnknownAccountRef {
                external_id: holding.account_external_id.clone(),
            })?;
        let instrument_id = resolve_instrument(&mut tx, &holding.instrument).await?;
        let holding_id = upsert_holding(&mut tx, account_id, instrument_id, holding).await?;
        present.insert(holding_id);

        // The snapshot value is in the account's currency: readers fall back to it when the holding has no price
        // or rate. Cash in the account's currency is worth its quantity; any other line is worth the provider's
        // valuation.
        let value = if holding.instrument.kind == "cash"
            && holding.instrument.currency == account_currency[&account_id]
        {
            holding.quantity
        } else {
            holding.valuation.unwrap_or(Decimal::ZERO)
        };
        let day = snapshot_day[&account_id];
        stamp_snapshot(&mut tx, holding_id, day, holding.quantity, value).await?;
        snapshots += 1;
    }

    // Close holdings absent from this sync (position sold, cash residual at zero): zero the position and
    // stamp a zero snapshot so latest-snapshot aggregations stop counting stale values. History is kept.
    let mut holdings_closed = 0;
    for (existing, account_id) in ids_for_connection(&mut tx, connection_id).await? {
        if !present.contains(&existing) {
            let day = snapshot_day.get(&account_id).copied().unwrap_or(today);
            zero_holding(&mut tx, existing).await?;
            stamp_snapshot(&mut tx, existing, day, Decimal::ZERO, Decimal::ZERO).await?;
            holdings_closed += 1;
        }
    }

    // Upsert on external_id: provider corrections propagate, the user's budget fields are never overwritten.
    let mut transactions_inserted = 0;
    let mut transactions_updated = 0;
    let mut transactions_skipped = 0usize;
    for txn in &sync.transactions {
        // A transaction naming an account this sync did not emit is skipped, not fatal: Powens' user-scoped
        // endpoint returns rows for accounts the adapter drops (liability, deleted), and failing would abort
        // every sync. Holdings keep a hard failure: `map_sync` guarantees that invariant.
        let Some(&account_id) = account_ids.get(txn.account_external_id.as_str()) else {
            tracing::debug!(
                account_external_id = %txn.account_external_id,
                txn_external_id = %txn.external_id,
                "transaction skipped: account not in this sync"
            );
            transactions_skipped += 1;
            continue;
        };
        match upsert_transaction(&mut tx, account_id, txn).await? {
            TxnWrite::Inserted => transactions_inserted += 1,
            TxnWrite::Updated => transactions_updated += 1,
        }
    }

    connection::set_health(&mut *tx, connection_id, sync.health.as_ref()).await?;

    // Guarded so a provider that momentarily reports nothing can't clobber a good value.
    if !sync.institution.key.is_empty() {
        connection::set_institution(&mut *tx, connection_id, &sync.institution).await?;
    }

    let backfill_rows = crate::backfill::backfill_user(&mut tx).await? as usize;

    // Scoped to the connection's owner: a transfer's two halves routinely live under two connections.
    let transfers_paired = crate::budget::pairing::pair_internal_transfers(&mut tx).await?;

    tx.commit().await?;

    Ok(IngestSummary {
        accounts: sync.accounts.len(),
        holdings: sync.holdings.len(),
        transactions_inserted,
        transactions_updated,
        transactions_skipped,
        snapshots,
        holdings_closed,
        backfill_rows,
        transfers_paired,
    })
}
