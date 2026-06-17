//! Session persistence for opaque bearer-token auth. The raw token never hits
//! the DB — only its SHA-256 hash. Authenticated requests look a session up by
//! hash; revoking is deleting the row.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::CoreError;

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
    expires_at: DateTime<Utc>,
) -> Result<Session, CoreError> {
    let row = sqlx::query_as!(
        Session,
        r#"insert into session
             (user_id, token_hash, user_agent, ip, remembered, expires_at)
           values ($1, $2, $3, $4, $5, $6)
           returning id, user_id, user_agent, ip, remembered,
                     created_at, last_active_at, expires_at"#,
        user_id,
        token_hash,
        user_agent,
        ip,
        remembered,
        expires_at,
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

/// Sliding-window bump applied on authenticated requests. Always advances
/// `last_active_at`; for remembered sessions it also pushes `expires_at` to
/// now + 30 days. Throttled by the caller (see `auth::TOUCH_THROTTLE_SECS`).
pub async fn touch(
    pool: &sqlx::PgPool,
    session_id: Uuid,
    remembered: bool,
) -> Result<(), CoreError> {
    if remembered {
        sqlx::query!(
            r#"update session
               set last_active_at = now(), expires_at = now() + interval '30 days'
               where id = $1"#,
            session_id,
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

/// Revoke every session of this user except `keep_id` (log out everywhere else;
/// also used after a password change). Returns the number removed.
pub async fn delete_others(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    keep_id: Uuid,
) -> Result<u64, CoreError> {
    let res = sqlx::query!(
        r#"delete from session where user_id = $1 and id <> $2"#,
        user_id,
        keep_id,
    )
    .execute(pool)
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

    async fn seed_user(pool: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, 'a@t.local', 'Ann', 'h', 'admin')",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
        id
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn create_then_find_by_hash(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let hash = vec![1u8, 2, 3, 4];
        let exp = Utc::now() + Duration::days(1);

        let created = create(
            &pool,
            user_id,
            &hash,
            Some("UA"),
            Some("1.2.3.4"),
            true,
            exp,
        )
        .await
        .unwrap();
        assert_eq!(created.user_id, user_id);
        assert!(created.remembered);

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

    #[sqlx::test(migrations = "../migrations")]
    async fn expired_session_is_not_found(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let hash = vec![5u8, 6];
        let past = Utc::now() - Duration::hours(1);
        create(&pool, user_id, &hash, None, None, false, past)
            .await
            .unwrap();
        assert!(find_valid_by_hash(&pool, &hash).await.unwrap().is_none());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn touch_extends_remembered_only(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let near = Utc::now() + Duration::minutes(5);

        // remembered → expiry slides out to ~30d
        let h1 = vec![1u8];
        let s1 = create(&pool, user_id, &h1, None, None, true, near)
            .await
            .unwrap();
        touch(&pool, s1.id, true).await.unwrap();
        let after = find_valid_by_hash(&pool, &h1).await.unwrap().unwrap();
        assert!(after.expires_at > Utc::now() + Duration::days(29));

        // not remembered → expiry unchanged
        let h2 = vec![2u8];
        let s2 = create(&pool, user_id, &h2, None, None, false, near)
            .await
            .unwrap();
        touch(&pool, s2.id, false).await.unwrap();
        let after2 = find_valid_by_hash(&pool, &h2).await.unwrap().unwrap();
        assert!(after2.expires_at < Utc::now() + Duration::days(1));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_is_user_scoped(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let other = Uuid::new_v4();
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
                 values ($1, 'b@t.local', 'Bo', 'h', 'user')",
        )
        .bind(other)
        .execute(&pool)
        .await
        .unwrap();

        let exp = Utc::now() + Duration::days(1);
        let s = create(&pool, user_id, &[1u8], None, None, false, exp)
            .await
            .unwrap();

        // wrong owner can't delete
        assert!(!delete(&pool, other, s.id).await.unwrap());
        assert!(find_valid_by_hash(&pool, &[1u8]).await.unwrap().is_some());
        // owner can
        assert!(delete(&pool, user_id, s.id).await.unwrap());
        assert!(find_valid_by_hash(&pool, &[1u8]).await.unwrap().is_none());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn list_and_delete_others(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let exp = Utc::now() + Duration::days(1);
        let keep = create(&pool, user_id, &[1u8], None, None, false, exp)
            .await
            .unwrap();
        create(&pool, user_id, &[2u8], None, None, false, exp)
            .await
            .unwrap();
        create(&pool, user_id, &[3u8], None, None, false, exp)
            .await
            .unwrap();

        assert_eq!(list_for_user(&pool, user_id).await.unwrap().len(), 3);

        let removed = delete_others(&pool, user_id, keep.id).await.unwrap();
        assert_eq!(removed, 2);
        let left = list_for_user(&pool, user_id).await.unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, keep.id);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_expired_removes_only_expired(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        create(
            &pool,
            user_id,
            &[1u8],
            None,
            None,
            false,
            Utc::now() - Duration::hours(1),
        )
        .await
        .unwrap();
        create(
            &pool,
            user_id,
            &[2u8],
            None,
            None,
            false,
            Utc::now() + Duration::days(1),
        )
        .await
        .unwrap();

        assert_eq!(delete_expired(&pool).await.unwrap(), 1);
        assert_eq!(list_for_user(&pool, user_id).await.unwrap().len(), 1);
    }
}
