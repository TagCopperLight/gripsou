//! Read + sync-state helpers for connections — the sync modal's data source.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::dto::SyncHealth;
use crate::error::CoreError;
use crate::text_enum::text_enum;

text_enum! {
    /// `connection.status`. `syncing` is the per-connection sync lock.
    pub enum ConnectionStatus {
        /// Created, its provider round-trip not done yet.
        Pending = "pending",
        Ok = "ok",
        Syncing = "syncing",
        Error = "error",
        /// A refresh was asked of the provider; its webhook has not come.
        Awaiting = "awaiting",
    }
}

pub struct ConnectionListRow {
    pub id: Uuid,
    pub provider_key: String,
    pub display_name: String,
    pub institution_name: Option<String>,
    pub institution_key: Option<String>,
    pub status: ConnectionStatus,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub health: Option<SyncHealth>,
}

/// All of a user's connections, ordered so that connections of the same
/// provider are adjacent (the API groups on that).
pub async fn list_connections(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<ConnectionListRow>, CoreError> {
    let rows = sqlx::query!(
        r#"
        select c.id           as "id!",
               c.provider_key  as "provider_key!",
               c.display_name  as "display_name!",
               c.institution_name,
               c.institution_key,
               c.status        as "status!: ConnectionStatus",
               c.last_sync_at,
               c.last_error,
               c.provider_meta as "provider_meta!"
        from connection c
        where c.user_id = $1
        order by c.provider_key, c.display_name, c.id
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| ConnectionListRow {
            health: SyncHealth::from_meta(&r.provider_meta),
            id: r.id,
            provider_key: r.provider_key,
            display_name: r.display_name,
            institution_name: r.institution_name,
            institution_key: r.institution_key,
            status: r.status,
            last_sync_at: r.last_sync_at,
            last_error: r.last_error,
        })
        .collect())
}

pub struct ConnectionAccountRow {
    pub health: Option<SyncHealth>,
    pub connection_id: Uuid,
    pub account_id: Uuid,
    pub name: String,
    pub color: String,
    pub type_key: String,
    /// Null when the reader's currency has no rate today.
    pub value: Option<Decimal>,
    pub last_sync_at: Option<DateTime<Utc>>,
}

/// Every account under a user's connections, valued today in the reader's
/// currency like the accounts grid (`account_values_today`), with the parent
/// connection's last sync time. Zero when it has nothing valued yet.
pub async fn list_connection_accounts(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<ConnectionAccountRow>, CoreError> {
    let rows = sqlx::query!(
        r#"
        select a.connection_id         as "connection_id!",
               a.id                    as "account_id!",
               a.name                  as "name!",
               a.color                 as "color",
               a.type_key              as "type_key!",
               case when v.account_id is null then 0 else v.value end as "value?",
               c.last_sync_at,
               a.provider_meta as "provider_meta!"
        from account a
        join connection c on c.id = a.connection_id
        left join account_values_today($1) v on v.account_id = a.id
        where c.user_id = $1
        order by a.name
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| ConnectionAccountRow {
            health: SyncHealth::from_meta(&r.provider_meta),
            connection_id: r.connection_id,
            account_id: r.account_id,
            name: r.name,
            color: r.color,
            type_key: r.type_key,
            value: r.value,
            last_sync_at: r.last_sync_at,
        })
        .collect())
}

pub struct ConnectionState {
    pub id: Uuid,
    pub status: ConnectionStatus,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

/// Outcome of attempting to claim a connection for syncing.
pub enum BeginSync {
    /// Claimed: status flipped to `syncing`. Carries the new state.
    Started(ConnectionState),
    /// Owned by the user but already syncing — caller should 409.
    AlreadySyncing,
    /// Not owned by the user / does not exist — caller should 404.
    NotFound,
}

/// Atomically claim a connection for syncing: flip status to `syncing` only if it
/// is owned by `user_id` and not already syncing. This is the per-connection
/// lock that prevents double runs. A sync always releases it: it ends, fails,
/// panics or hits its time limit, and a restart clears it at boot.
pub async fn begin_sync(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<BeginSync, CoreError> {
    let claimed = sqlx::query_as!(
        ConnectionState,
        r#"
        update connection
           set status = $3
         where id = $1 and user_id = $2 and status <> $3
        returning id as "id!", status as "status!: ConnectionStatus", last_sync_at, last_error
        "#,
        id,
        user_id,
        ConnectionStatus::Syncing as ConnectionStatus,
    )
    .fetch_optional(pool)
    .await?;

    claim_outcome(pool, user_id, id, claimed).await
}

/// A claim's outcome. No claimed row means either "already busy" or "not
/// owned"; only then is it worth a second query to tell them apart.
async fn claim_outcome(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
    claimed: Option<ConnectionState>,
) -> Result<BeginSync, CoreError> {
    if let Some(state) = claimed {
        return Ok(BeginSync::Started(state));
    }
    let exists = sqlx::query_scalar!(
        r#"select exists(select 1 from connection where id = $1 and user_id = $2) as "exists!""#,
        id,
        user_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(if exists {
        BeginSync::AlreadySyncing
    } else {
        BeginSync::NotFound
    })
}

pub async fn mark_synced_ok(pool: &sqlx::PgPool, id: Uuid) -> Result<(), CoreError> {
    sqlx::query!(
        "update connection
            set status = $2, last_sync_at = now(), last_error = null
          where id = $1",
        id,
        ConnectionStatus::Ok as ConnectionStatus,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Mark a finished sync as failed, recording the message.
pub async fn mark_synced_error(pool: &sqlx::PgPool, id: Uuid, msg: &str) -> Result<(), CoreError> {
    sqlx::query!(
        "update connection set status = $3, last_error = $2 where id = $1",
        id,
        msg,
        ConnectionStatus::Error as ConnectionStatus,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn provider_key(pool: &sqlx::PgPool, id: Uuid) -> Result<Option<String>, CoreError> {
    let key = sqlx::query_scalar!("select provider_key from connection where id = $1", id)
        .fetch_optional(pool)
        .await?;
    Ok(key)
}

/// Who owns a connection. `None` for an unknown id.
pub async fn user_id(db: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Uuid>, CoreError> {
    let row = sqlx::query_scalar!("select user_id from connection where id = $1", id)
        .fetch_optional(db)
        .await?;
    Ok(row)
}

/// Records the connection's health as of this sync, beside its native ids
/// in `provider_meta`.
pub async fn set_health(
    db: impl sqlx::PgExecutor<'_>,
    id: Uuid,
    health: Option<&SyncHealth>,
) -> Result<(), CoreError> {
    sqlx::query!(
        "update connection set provider_meta = provider_meta || $2 where id = $1",
        id,
        SyncHealth::into_meta(health, serde_json::json!({})),
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn set_institution(
    db: impl sqlx::PgExecutor<'_>,
    id: Uuid,
    institution: &crate::dto::Institution,
) -> Result<(), CoreError> {
    sqlx::query!(
        "update connection set institution_key = $2, institution_name = $3 where id = $1",
        id,
        institution.key,
        institution.name,
    )
    .execute(db)
    .await?;
    Ok(())
}

/// What a sync reads of its connection: the provider and the sealed
/// credentials.
pub struct SyncSource {
    pub provider_key: String,
    pub credentials: serde_json::Value,
}

pub async fn sync_source(pool: &sqlx::PgPool, id: Uuid) -> Result<Option<SyncSource>, CoreError> {
    let row = sqlx::query_as!(
        SyncSource,
        "select provider_key, credentials from connection where id = $1",
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn ids_for_user(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<Uuid>, CoreError> {
    let ids = sqlx::query_scalar!(
        r#"select id as "id!" from connection where user_id = $1"#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

pub struct ActiveConnection {
    pub id: Uuid,
    pub user_id: Uuid,
}

/// Connections not synced in the last `hours` (for the daily sync job).
pub async fn connections_needing_sync(
    pool: &sqlx::PgPool,
    hours: i32,
) -> Result<Vec<ActiveConnection>, CoreError> {
    let rows = sqlx::query_as!(
        ActiveConnection,
        r#"
        select id as "id!", user_id as "user_id!"
        from connection
        where status in ($1, $2)
          and (last_sync_at is null or last_sync_at < now() - make_interval(hours => $3))
        "#,
        ConnectionStatus::Ok as ConnectionStatus,
        ConnectionStatus::Error as ConnectionStatus,
        hours,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// `awaiting` connections whose force-refresh has not produced a webhook within
/// `minutes` — candidates for the direct-fetch fallback.
pub async fn connections_awaiting_timeout(
    pool: &sqlx::PgPool,
    minutes: i32,
) -> Result<Vec<ActiveConnection>, CoreError> {
    let rows = sqlx::query_as!(
        ActiveConnection,
        r#"
        select id as "id!", user_id as "user_id!"
        from connection
        where status = $2
          and sync_requested_at < now() - make_interval(mins => $1)
        "#,
        minutes,
        ConnectionStatus::Awaiting as ConnectionStatus,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Boot sweep: release every sync lock. The process that claimed them is
/// gone, so the syncs behind them will never finish or report. They are marked
/// `error` rather than `ok`: a user looking at the connection must see that
/// the sync did not complete. Returns the number of rows released.
pub async fn clear_syncing(pool: &sqlx::PgPool) -> Result<u64, CoreError> {
    let res = sqlx::query!(
        "update connection
            set status = $1,
                last_error = 'sync interrupted (the server restarted)'
          where status = $2",
        ConnectionStatus::Error as ConnectionStatus,
        ConnectionStatus::Syncing as ConnectionStatus,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Delete `pending` connections older than `minutes` — webview flows the user
/// abandoned (closed the tab) so the callback never ran to clean them up.
/// Returns the number of rows deleted.
pub async fn delete_stale_pending(pool: &sqlx::PgPool, minutes: i32) -> Result<u64, CoreError> {
    let res = sqlx::query!(
        "delete from connection
         where status = $2 and created_at < now() - make_interval(mins => $1)",
        minutes,
        ConnectionStatus::Pending as ConnectionStatus,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Insert a new connection in `pending` state (OAuth round-trip not yet done).
/// Returns the new connection id.
pub async fn insert_pending(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    provider_key: &str,
    display_name: &str,
) -> Result<Uuid, CoreError> {
    let id = sqlx::query_scalar!(
        r#"
        insert into connection (user_id, provider_key, display_name, status)
        values ($1, $2, $3, $4)
        returning id as "id!"
        "#,
        user_id,
        provider_key,
        display_name,
        ConnectionStatus::Pending as ConnectionStatus,
    )
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Store credentials and flip a pending connection to `ok`. False when the
/// connection isn't `user_id`'s or isn't pending: a replayed callback never
/// touches an active connection.
pub async fn finish_connect(
    pool: &sqlx::PgPool,
    id: Uuid,
    user_id: Uuid,
    credentials: serde_json::Value,
    provider_meta: serde_json::Value,
) -> Result<bool, CoreError> {
    let n = sqlx::query!(
        r#"
        update connection
           set credentials = $3, provider_meta = $4, status = $5
         where id = $1 and user_id = $2 and status = $6
        "#,
        id,
        user_id,
        credentials,
        provider_meta,
        ConnectionStatus::Ok as ConnectionStatus,
        ConnectionStatus::Pending as ConnectionStatus,
    )
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n > 0)
}

pub struct ConnForSync {
    pub provider_key: String,
    pub credentials: serde_json::Value,
    pub provider_meta: serde_json::Value,
}

/// Read an owned connection's provider info (no mutation). None => not found/owned.
pub async fn connection_for_sync(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<Option<ConnForSync>, CoreError> {
    let row = sqlx::query!(
        r#"select provider_key as "provider_key!", credentials as "credentials!",
                  provider_meta as "provider_meta!"
           from connection where id=$1 and user_id=$2"#,
        id,
        user_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| ConnForSync {
        provider_key: r.provider_key,
        credentials: r.credentials,
        provider_meta: r.provider_meta,
    }))
}

/// Atomically transition an owned connection to `awaiting` (force-refresh
/// requested). Rejects if already `syncing` or `awaiting`.
pub async fn begin_await(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<BeginSync, CoreError> {
    let claimed = sqlx::query_as!(
        ConnectionState,
        r#"
        update connection
           set status = $3, sync_requested_at = now(), last_error = null
         where id = $1 and user_id = $2 and status not in ($3, $4)
        returning id as "id!", status as "status!: ConnectionStatus", last_sync_at, last_error
        "#,
        id,
        user_id,
        ConnectionStatus::Awaiting as ConnectionStatus,
        ConnectionStatus::Syncing as ConnectionStatus,
    )
    .fetch_optional(pool)
    .await?;
    claim_outcome(pool, user_id, id, claimed).await
}

/// Find a connection by provider + native connection id stored in provider_meta.
pub async fn find_by_external_connection_id(
    pool: &sqlx::PgPool,
    provider_key: &str,
    ext_id: &str,
) -> Result<Option<(Uuid, Uuid)>, CoreError> {
    let row = sqlx::query!(
        r#"select id as "id!", user_id as "user_id!"
           from connection
           where provider_key=$1 and provider_meta->>$3 = $2"#,
        provider_key,
        ext_id,
        crate::provider::EXTERNAL_CONNECTION_ID,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| (r.id, r.user_id)))
}

/// Delete `user_id`'s connection `id` if it is still `pending`: a connect
/// that failed or was cancelled. An active connection is never touched.
pub async fn delete_pending(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<bool, CoreError> {
    let n = sqlx::query!(
        "delete from connection where id = $1 and user_id = $2 and status = $3",
        id,
        user_id,
        ConnectionStatus::Pending as ConnectionStatus,
    )
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n > 0)
}

/// Delete a connection and all its cascade-deleted data.
/// Returns true if a row was deleted, false if not found or not owned by `user_id`.
pub async fn delete_connection(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<bool, CoreError> {
    let n = sqlx::query!(
        "delete from connection where id = $1 and user_id = $2",
        id,
        user_id,
    )
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n > 0)
}
