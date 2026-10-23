//! Saved passkeys. `passkey` is the serialised webauthn-rs `Passkey`, opaque
//! here: the API layer reads and writes it.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::CoreError;

pub struct PasskeyRow {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

pub struct StoredPasskey {
    pub id: Uuid,
    pub passkey: serde_json::Value,
}

/// The user's passkeys, newest first.
pub async fn list(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<PasskeyRow>, CoreError> {
    Ok(sqlx::query_as!(
        PasskeyRow,
        r#"select id, name, created_at, last_used_at from user_passkey
           where user_id = $1 order by created_at desc, id"#,
        user_id,
    )
    .fetch_all(pool)
    .await?)
}

pub async fn stored(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<StoredPasskey>, CoreError> {
    Ok(sqlx::query_as!(
        StoredPasskey,
        r#"select id, passkey from user_passkey where user_id = $1"#,
        user_id,
    )
    .fetch_all(pool)
    .await?)
}

pub async fn credential_ids(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<Vec<u8>>, CoreError> {
    Ok(sqlx::query_scalar!(
        r#"select credential_id from user_passkey where user_id = $1"#,
        user_id,
    )
    .fetch_all(pool)
    .await?)
}

/// One of the user's passkeys by credential id; another user's is invisible.
pub async fn find(
    db: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
    credential_id: &[u8],
) -> Result<Option<StoredPasskey>, CoreError> {
    Ok(sqlx::query_as!(
        StoredPasskey,
        r#"select id, passkey from user_passkey where user_id = $1 and credential_id = $2"#,
        user_id,
        credential_id,
    )
    .fetch_optional(db)
    .await?)
}

/// `None` when the credential is already saved (for anyone).
pub async fn insert(
    db: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
    credential_id: &[u8],
    passkey: &serde_json::Value,
    name: &str,
) -> Result<Option<PasskeyRow>, CoreError> {
    Ok(sqlx::query_as!(
        PasskeyRow,
        r#"insert into user_passkey (user_id, credential_id, passkey, name)
           values ($1, $2, $3, $4)
           on conflict (credential_id) do nothing
           returning id, name, created_at, last_used_at"#,
        user_id,
        credential_id,
        passkey,
        name,
    )
    .fetch_optional(db)
    .await?)
}

/// After a sign-in: the updated passkey (sign counter) and when it was used.
pub async fn record_use(
    db: impl sqlx::PgExecutor<'_>,
    id: Uuid,
    passkey: &serde_json::Value,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"update user_passkey set passkey = $2, last_used_at = now() where id = $1"#,
        id,
        passkey,
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn rename(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
    name: &str,
) -> Result<bool, CoreError> {
    let res = sqlx::query!(
        r#"update user_passkey set name = $3 where id = $1 and user_id = $2"#,
        id,
        user_id,
        name,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

pub async fn delete(pool: &sqlx::PgPool, user_id: Uuid, id: Uuid) -> Result<bool, CoreError> {
    let res = sqlx::query!(
        r#"delete from user_passkey where id = $1 and user_id = $2"#,
        id,
        user_id,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    async fn seed_user(pool: &PgPool, email: &str) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("insert into users (id, email, name, password_hash, role) values ($1, $2, 'T', 'h', 'user')")
            .bind(id).bind(email).execute(pool).await.unwrap();
        id
    }

    fn pk(n: u8) -> serde_json::Value {
        serde_json::json!({ "n": n })
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn insert_list_find_and_scope(pool: PgPool) {
        let a = seed_user(&pool, "a@t.local").await;
        let b = seed_user(&pool, "b@t.local").await;
        let first = insert(&pool, a, &[1], &pk(1), "Firefox on Linux")
            .await
            .unwrap()
            .unwrap();
        let second = insert(&pool, a, &[2], &pk(2), "Safari on iOS")
            .await
            .unwrap()
            .unwrap();
        insert(&pool, b, &[3], &pk(3), "B").await.unwrap().unwrap();
        // The same credential can't be added twice, even by someone else.
        assert!(
            insert(&pool, b, &[1], &pk(9), "dup")
                .await
                .unwrap()
                .is_none()
        );

        let rows = list(&pool, a).await.unwrap();
        assert_eq!(
            rows.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![second.id, first.id]
        );
        assert!(rows.iter().all(|r| r.last_used_at.is_none()));
        assert_eq!(credential_ids(&pool, a).await.unwrap().len(), 2);
        assert_eq!(stored(&pool, a).await.unwrap().len(), 2);

        assert_eq!(find(&pool, a, &[1]).await.unwrap().unwrap().passkey, pk(1));
        assert!(
            find(&pool, b, &[1]).await.unwrap().is_none(),
            "another user's credential"
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn record_use_rename_delete(pool: PgPool) {
        let a = seed_user(&pool, "a@t.local").await;
        let b = seed_user(&pool, "b@t.local").await;
        let row = insert(&pool, a, &[1], &pk(1), "old")
            .await
            .unwrap()
            .unwrap();

        record_use(&pool, row.id, &pk(2)).await.unwrap();
        assert_eq!(find(&pool, a, &[1]).await.unwrap().unwrap().passkey, pk(2));
        assert!(list(&pool, a).await.unwrap()[0].last_used_at.is_some());

        assert!(!rename(&pool, b, row.id, "theirs").await.unwrap());
        assert!(rename(&pool, a, row.id, "new").await.unwrap());
        assert_eq!(list(&pool, a).await.unwrap()[0].name, "new");

        assert!(!delete(&pool, b, row.id).await.unwrap());
        assert!(delete(&pool, a, row.id).await.unwrap());
        assert!(list(&pool, a).await.unwrap().is_empty());
    }
}
