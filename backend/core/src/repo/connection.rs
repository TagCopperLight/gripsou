use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::dto::SyncHealth;
use crate::error::CoreError;
use crate::text_enum::text_enum;

text_enum! {
    pub enum ConnectionStatus {
        Pending = "pending",
        Ok = "ok",
        Syncing = "syncing",
        Error = "error",
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

/// Connections of one provider are adjacent: the API groups on that.
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

pub enum BeginSync {
    Started(ConnectionState),
    AlreadySyncing,
    NotFound,
}

/// The per-connection sync lock. A `pending` connection has no credentials yet, so it
/// cannot be claimed.
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
         where id = $1 and user_id = $2 and status in ($4, $5, $6)
        returning id as "id!", status as "status!: ConnectionStatus", last_sync_at, last_error
        "#,
        id,
        user_id,
        ConnectionStatus::Syncing as ConnectionStatus,
        ConnectionStatus::Ok as ConnectionStatus,
        ConnectionStatus::Error as ConnectionStatus,
        ConnectionStatus::Awaiting as ConnectionStatus,
    )
    .fetch_optional(pool)
    .await?;

    claim_outcome(pool, user_id, id, claimed).await
}

/// A `pending` connection counts as not there.
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
        r#"select exists(
               select 1 from connection where id = $1 and user_id = $2 and status <> $3
           ) as "exists!""#,
        id,
        user_id,
        ConnectionStatus::Pending as ConnectionStatus,
    )
    .fetch_one(pool)
    .await?;
    Ok(if exists {
        BeginSync::AlreadySyncing
    } else {
        BeginSync::NotFound
    })
}

/// A sync that lost the lock must not release one another sync has taken.
pub async fn mark_synced_ok(pool: &sqlx::PgPool, id: Uuid) -> Result<(), CoreError> {
    sqlx::query!(
        "update connection
            set status = $2, last_sync_at = now(), last_error = null
          where id = $1 and status = $3",
        id,
        ConnectionStatus::Ok as ConnectionStatus,
        ConnectionStatus::Syncing as ConnectionStatus,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_synced_error(pool: &sqlx::PgPool, id: Uuid, msg: &str) -> Result<(), CoreError> {
    release_with_error(pool, id, ConnectionStatus::Syncing, msg).await
}

/// A connection the awaiting-timeout fallback already claimed is left to that sync.
pub async fn mark_refresh_failed(
    pool: &sqlx::PgPool,
    id: Uuid,
    msg: &str,
) -> Result<(), CoreError> {
    release_with_error(pool, id, ConnectionStatus::Awaiting, msg).await
}

async fn release_with_error(
    pool: &sqlx::PgPool,
    id: Uuid,
    held: ConnectionStatus,
    msg: &str,
) -> Result<(), CoreError> {
    sqlx::query!(
        "update connection set status = $3, last_error = $2 where id = $1 and status = $4",
        id,
        msg,
        ConnectionStatus::Error as ConnectionStatus,
        held as ConnectionStatus,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// `None` once active or not the user's: a replayed or foreign callback never reaches
/// the provider.
pub async fn pending_provider_key(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<Option<String>, CoreError> {
    let key = sqlx::query_scalar!(
        "select provider_key from connection where id = $1 and user_id = $2 and status = $3",
        id,
        user_id,
        ConnectionStatus::Pending as ConnectionStatus,
    )
    .fetch_optional(pool)
    .await?;
    Ok(key)
}

pub async fn user_id(db: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Uuid>, CoreError> {
    let row = sqlx::query_scalar!("select user_id from connection where id = $1", id)
        .fetch_optional(db)
        .await?;
    Ok(row)
}

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

/// A `pending` connection is still on the provider's page.
pub async fn ids_for_user(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<Uuid>, CoreError> {
    let ids = sqlx::query_scalar!(
        r#"select id as "id!" from connection where user_id = $1 and status <> $2"#,
        user_id,
        ConnectionStatus::Pending as ConnectionStatus,
    )
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

pub struct ActiveConnection {
    pub id: Uuid,
    pub user_id: Uuid,
}

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

/// Marked `error`, not `ok`: the claiming process is gone and the sync did not complete.
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

/// False when not the user's or not pending: a replayed callback never touches an active
/// connection.
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
         where id = $1 and user_id = $2 and status in ($4, $5)
        returning id as "id!", status as "status!: ConnectionStatus", last_sync_at, last_error
        "#,
        id,
        user_id,
        ConnectionStatus::Awaiting as ConnectionStatus,
        ConnectionStatus::Ok as ConnectionStatus,
        ConnectionStatus::Error as ConnectionStatus,
    )
    .fetch_optional(pool)
    .await?;
    claim_outcome(pool, user_id, id, claimed).await
}

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
