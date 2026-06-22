//! Read + sync-state helpers for connections — the sync modal's data source.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

pub struct ConnectionListRow {
    pub id: Uuid,
    pub provider_key: String,
    pub provider_name: String,
    pub display_name: String,
    pub status: String,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

/// All of a user's connections joined to their provider, ordered so that
/// connections of the same provider are adjacent (the API groups on that).
pub async fn list_connections(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<ConnectionListRow>, CoreError> {
    let rows = sqlx::query_as!(
        ConnectionListRow,
        r#"
        select c.id           as "id!",
               c.provider_key  as "provider_key!",
               p.display_name  as "provider_name!",
               c.display_name  as "display_name!",
               c.status        as "status!",
               c.last_sync_at,
               c.last_error
        from connection c
        join provider p on p.key = c.provider_key
        where c.user_id = $1
        order by p.display_name, c.display_name, c.id
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct ConnectionAccountRow {
    pub connection_id: Uuid,
    pub account_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub type_label: String,
    pub value: Decimal,
    pub last_sync_at: Option<DateTime<Utc>>,
}

/// Every account under a user's connections, with its latest-snapshot value
/// (0 when it has no snapshots yet) and the parent connection's last sync time.
pub async fn list_connection_accounts(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<ConnectionAccountRow>, CoreError> {
    let rows = sqlx::query_as!(
        ConnectionAccountRow,
        r#"
        with latest as (
            select distinct on (hs.holding_id) h.account_id, hs.value
            from holding_snapshot hs
            join holding h on h.id = hs.holding_id
            order by hs.holding_id, hs.as_of desc
        )
        select a.connection_id        as "connection_id!",
               a.id                    as "account_id!",
               a.name                  as "name!",
               a.color                 as "color",
               t.label                 as "type_label!",
               coalesce(sum(l.value), 0) as "value!",
               c.last_sync_at
        from account a
        join connection c   on c.id = a.connection_id
        join account_type t on t.key = a.type_key
        left join latest l  on l.account_id = a.id
        where c.user_id = $1 and a.connection_id is not null
        group by a.connection_id, a.id, a.name, a.color, t.label, c.last_sync_at
        order by a.name
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct ConnectionState {
    pub id: Uuid,
    pub status: String,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

/// Outcome of attempting to claim a connection for syncing.
pub enum BeginSync {
    /// Claimed: status flipped to 'syncing'. Carries the new state.
    Started(ConnectionState),
    /// Owned by the user but already syncing — caller should 409.
    AlreadySyncing,
    /// Not owned by the user / does not exist — caller should 404.
    NotFound,
}

/// Atomically claim a connection for syncing: flip status→'syncing' only if it
/// is owned by `user_id` and not already syncing. This is the per-connection
/// lock that prevents double runs.
pub async fn begin_sync(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<BeginSync, CoreError> {
    let claimed = sqlx::query_as!(
        ConnectionState,
        r#"
        update connection
           set status = 'syncing'
         where id = $1 and user_id = $2 and status <> 'syncing'
        returning id as "id!", status as "status!", last_sync_at, last_error
        "#,
        id,
        user_id,
    )
    .fetch_optional(pool)
    .await?;

    if let Some(state) = claimed {
        return Ok(BeginSync::Started(state));
    }
    // None means either "already syncing" or "not owned" — distinguish.
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

/// Mark a finished sync as successful.
pub async fn mark_synced_ok(pool: &sqlx::PgPool, id: Uuid) -> Result<(), CoreError> {
    sqlx::query!(
        "update connection set status='ok', last_sync_at=now(), last_error=null where id=$1",
        id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Mark a finished sync as failed, recording the message.
pub async fn mark_synced_error(pool: &sqlx::PgPool, id: Uuid, msg: &str) -> Result<(), CoreError> {
    sqlx::query!(
        "update connection set status='error', last_error=$2 where id=$1",
        id,
        msg,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Provider key for a connection (for the orchestrator's adapter lookup).
pub async fn provider_key(pool: &sqlx::PgPool, id: Uuid) -> Result<Option<String>, CoreError> {
    let key = sqlx::query_scalar!("select provider_key from connection where id = $1", id)
        .fetch_optional(pool)
        .await?;
    Ok(key)
}

/// Fetch the encrypted credentials blob for a connection.
/// Returns `None` if the connection does not exist or has no credentials yet.
pub async fn get_credentials(
    pool: &sqlx::PgPool,
    id: Uuid,
) -> Result<Option<serde_json::Value>, CoreError> {
    let row = sqlx::query!("select credentials from connection where id = $1", id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.credentials))
}

/// All connection ids for a user (for "sync all").
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

/// Connections that haven't been synced in the last 23 hours (for daily sync job).
pub async fn connections_needing_sync(
    pool: &sqlx::PgPool,
) -> Result<Vec<ActiveConnection>, CoreError> {
    let rows = sqlx::query_as!(
        ActiveConnection,
        r#"
        select id as "id!", user_id as "user_id!"
        from connection
        where status in ('ok', 'error')
          and (last_sync_at is null or last_sync_at < now() - interval '23 hours')
        "#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// 'awaiting' connections whose force-refresh has not produced a webhook within
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
        where status='awaiting'
          and sync_requested_at < now() - make_interval(mins => $1)
        "#,
        minutes,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Delete 'pending' connections older than `minutes` — webview flows the user
/// abandoned (closed the tab) so the callback never ran to clean them up.
/// Returns the number of rows deleted.
pub async fn delete_stale_pending(pool: &sqlx::PgPool, minutes: i32) -> Result<u64, CoreError> {
    let res = sqlx::query!(
        "delete from connection
         where status='pending' and created_at < now() - make_interval(mins => $1)",
        minutes,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Insert a new connection in 'pending' state (OAuth round-trip not yet done).
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
        values ($1, $2, $3, 'pending')
        returning id as "id!"
        "#,
        user_id,
        provider_key,
        display_name,
    )
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Store credentials and flip a pending connection to 'ok'.
/// Returns true if the connection was found and owned by `user_id`.
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
           set credentials = $3, provider_meta = $4, status = 'ok'
         where id = $1 and user_id = $2
        "#,
        id,
        user_id,
        credentials,
        provider_meta,
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

/// Atomically transition an owned connection to 'awaiting' (force-refresh
/// requested). Rejects if already 'syncing' or 'awaiting'.
pub async fn begin_await(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<BeginSync, CoreError> {
    let claimed = sqlx::query_as!(
        ConnectionState,
        r#"
        update connection
           set status='awaiting', sync_requested_at=now(), last_error=null
         where id=$1 and user_id=$2 and status not in ('syncing','awaiting')
        returning id as "id!", status as "status!", last_sync_at, last_error
        "#,
        id,
        user_id,
    )
    .fetch_optional(pool)
    .await?;
    if let Some(state) = claimed {
        return Ok(BeginSync::Started(state));
    }
    let exists = sqlx::query_scalar!(
        r#"select exists(select 1 from connection where id=$1 and user_id=$2) as "e!""#,
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

/// Find a connection by provider + native connection id stored in provider_meta.
pub async fn find_by_external_connection_id(
    pool: &sqlx::PgPool,
    provider_key: &str,
    ext_id: &str,
) -> Result<Option<(Uuid, Uuid)>, CoreError> {
    let row = sqlx::query!(
        r#"select id as "id!", user_id as "user_id!"
           from connection
           where provider_key=$1 and provider_meta->>'external_connection_id' = $2"#,
        provider_key,
        ext_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| (r.id, r.user_id)))
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
