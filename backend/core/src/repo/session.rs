//! Session persistence for opaque bearer-token auth. The raw token never hits
//! the DB — only its SHA-256 hash. Authenticated requests look a session up by
//! hash; revoking is deleting the row.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::CoreError;

/// A remembered session lasts this long after its last use: each touch
/// pushes the expiry out again.
pub const REMEMBERED_DAYS: i32 = 30;
/// Any other session ends this long after sign-in, used or not.
pub const UNREMEMBERED_DAYS: i32 = 1;

pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
    pub remembered: bool,
    pub created_at: DateTime<Utc>,
    pub last_active_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

pub async fn create(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    token_hash: &[u8],
    user_agent: Option<&str>,
    ip: Option<&str>,
    remembered: bool,
) -> Result<Session, CoreError> {
    let days = if remembered {
        REMEMBERED_DAYS
    } else {
        UNREMEMBERED_DAYS
    };
    let row = sqlx::query_as!(
        Session,
        r#"insert into session
             (user_id, token_hash, user_agent, ip, remembered, expires_at)
           values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
           returning id, user_id, user_agent, ip, remembered,
                     created_at, last_active_at, expires_at"#,
        user_id,
        token_hash,
        user_agent,
        ip,
        remembered,
        days,
    )
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// A session is valid only while unexpired. Looked up by the SHA-256 hash of
/// the bearer token on every authenticated request.
pub async fn find_valid_by_hash(
    pool: &sqlx::PgPool,
    token_hash: &[u8],
) -> Result<Option<Session>, CoreError> {
    let row = sqlx::query_as!(
        Session,
        r#"select id, user_id, user_agent, ip, remembered,
                  created_at, last_active_at, expires_at
           from session
           where token_hash = $1 and expires_at > now()"#,
        token_hash,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Mark the session used; a remembered one gets [`REMEMBERED_DAYS`] more.
pub async fn touch(
    pool: &sqlx::PgPool,
    session_id: Uuid,
    remembered: bool,
) -> Result<(), CoreError> {
    if remembered {
        sqlx::query!(
            r#"update session
               set last_active_at = now(), expires_at = now() + make_interval(days => $2)
               where id = $1"#,
            session_id,
            REMEMBERED_DAYS,
        )
        .execute(pool)
        .await?;
    } else {
        sqlx::query!(
            r#"update session set last_active_at = now() where id = $1"#,
            session_id,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Revoke a session, scoped to its owner so a user can never delete another
/// user's session. Returns whether a row was removed.
pub async fn delete(pool: &sqlx::PgPool, user_id: Uuid, id: Uuid) -> Result<bool, CoreError> {
    let res = sqlx::query!(
        r#"delete from session where id = $1 and user_id = $2"#,
        id,
        user_id,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

pub async fn list_for_user(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<Session>, CoreError> {
    let rows = sqlx::query_as!(
        Session,
        r#"select id, user_id, user_agent, ip, remembered,
                  created_at, last_active_at, expires_at
           from session
           where user_id = $1
           order by last_active_at desc"#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Sign the user out everywhere, except on `keep` (the session asking, when
/// it stays signed in). Runs on a pool or in a caller's transaction. Returns
/// the number removed.
pub async fn delete_all(
    db: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
    keep: Option<Uuid>,
) -> Result<u64, CoreError> {
    let res = sqlx::query!(
        r#"delete from session where user_id = $1 and id is distinct from $2"#,
        user_id,
        keep,
    )
    .execute(db)
    .await?;
    Ok(res.rows_affected())
}

/// Housekeeping: drop sessions past their expiry. Lookups already ignore them;
/// this just reclaims rows.
pub async fn delete_expired(pool: &sqlx::PgPool) -> Result<u64, CoreError> {
    let res = sqlx::query!(r#"delete from session where expires_at <= now()"#)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use sqlx::PgPool;

    use crate::testkit::{expire, seed_user};

    async fn expire_session(pool: &PgPool, id: Uuid) {
        expire(pool, "session", "id = $1", id).await;
    }

    #[crate::testkit::db_test]
    async fn create_then_find_by_hash(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let hash = vec![1u8, 2, 3, 4];

        let created = create(&pool, user_id, &hash, Some("UA"), Some("1.2.3.4"), true)
            .await
            .unwrap();
        assert_eq!(created.user_id, user_id);
        assert!(created.remembered);
        assert!(created.expires_at > Utc::now() + Duration::days(29));

        let found = find_valid_by_hash(&pool, &hash).await.unwrap().unwrap();
        assert_eq!(found.id, created.id);
        assert_eq!(found.ip.as_deref(), Some("1.2.3.4"));

        assert!(
            find_valid_by_hash(&pool, &[9u8, 9])
                .await
                .unwrap()
                .is_none()
        );
    }

    #[crate::testkit::db_test]
    async fn expired_session_is_not_found(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let hash = vec![5u8, 6];
        let s = create(&pool, user_id, &hash, None, None, false)
            .await
            .unwrap();
        assert!(s.expires_at < Utc::now() + Duration::days(1));
        expire_session(&pool, s.id).await;
        assert!(find_valid_by_hash(&pool, &hash).await.unwrap().is_none());
    }

    #[crate::testkit::db_test]
    async fn touch_extends_remembered_only(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let soon = |id: Uuid| {
            sqlx::query(
                "update session set expires_at = now() + interval '5 minutes' where id = $1",
            )
            .bind(id)
            .execute(&pool)
        };

        // remembered → expiry slides out to ~30d
        let h1 = vec![1u8];
        let s1 = create(&pool, user_id, &h1, None, None, true).await.unwrap();
        soon(s1.id).await.unwrap();
        touch(&pool, s1.id, true).await.unwrap();
        let after = find_valid_by_hash(&pool, &h1).await.unwrap().unwrap();
        assert!(after.expires_at > Utc::now() + Duration::days(29));

        // not remembered → expiry unchanged
        let h2 = vec![2u8];
        let s2 = create(&pool, user_id, &h2, None, None, false)
            .await
            .unwrap();
        soon(s2.id).await.unwrap();
        touch(&pool, s2.id, false).await.unwrap();
        let after2 = find_valid_by_hash(&pool, &h2).await.unwrap().unwrap();
        assert!(after2.expires_at < Utc::now() + Duration::minutes(6));
    }

    #[crate::testkit::db_test]
    async fn delete_is_user_scoped(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let other = seed_user(&pool).await;

        let s = create(&pool, user_id, &[1u8], None, None, false)
            .await
            .unwrap();

        // wrong owner can't delete
        assert!(!delete(&pool, other, s.id).await.unwrap());
        assert!(find_valid_by_hash(&pool, &[1u8]).await.unwrap().is_some());
        // owner can
        assert!(delete(&pool, user_id, s.id).await.unwrap());
        assert!(find_valid_by_hash(&pool, &[1u8]).await.unwrap().is_none());
    }

    #[crate::testkit::db_test]
    async fn delete_expired_removes_only_expired(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let old = create(&pool, user_id, &[1u8], None, None, false)
            .await
            .unwrap();
        expire_session(&pool, old.id).await;
        create(&pool, user_id, &[2u8], None, None, false)
            .await
            .unwrap();

        assert_eq!(delete_expired(&pool).await.unwrap(), 1);
        assert_eq!(list_for_user(&pool, user_id).await.unwrap().len(), 1);
    }
}
