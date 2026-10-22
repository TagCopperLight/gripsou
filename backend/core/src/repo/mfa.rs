//! Second factors: TOTP secret, recovery codes and passkey counts.

use uuid::Uuid;

use crate::error::CoreError;

pub struct TotpRow {
    pub secret_enc: String,
    pub confirmed: bool,
    pub last_used_step: Option<i64>,
}

/// The user's TOTP row, confirmed or not.
pub async fn totp(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Option<TotpRow>, CoreError> {
    let row = sqlx::query_as!(
        TotpRow,
        r#"select secret_enc, confirmed_at is not null as "confirmed!", last_used_step
           from user_totp where user_id = $1"#,
        user_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Start (or restart) TOTP setup: inserts, or replaces an unconfirmed row.
/// Returns `false` and writes nothing when a confirmed row exists.
pub async fn upsert_unconfirmed_totp(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    secret_enc: &str,
) -> Result<bool, CoreError> {
    let res = sqlx::query!(
        r#"insert into user_totp (user_id, secret_enc) values ($1, $2)
           on conflict (user_id) do update
             set secret_enc = excluded.secret_enc,
                 last_used_step = null,
                 created_at = now()
             where user_totp.confirmed_at is null"#,
        user_id,
        secret_enc,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// Finish TOTP setup in one transaction: confirms the unconfirmed row (stamping
/// the accepted `step`) and replaces the recovery codes. `false`, with nothing
/// written, when there is no unconfirmed row.
pub async fn confirm_totp(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    step: i64,
    code_hashes: &[Vec<u8>],
) -> Result<bool, CoreError> {
    let mut tx = pool.begin().await?;
    let res = sqlx::query!(
        r#"update user_totp set confirmed_at = now(), last_used_step = $2
           where user_id = $1 and confirmed_at is null"#,
        user_id,
        step,
    )
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() != 1 {
        return Ok(false);
    }
    write_codes(&mut tx, user_id, code_hashes).await?;
    tx.commit().await?;
    Ok(true)
}

/// Delete all of the user's recovery codes and insert `code_hashes`.
async fn write_codes(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    code_hashes: &[Vec<u8>],
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"delete from user_recovery_code where user_id = $1"#,
        user_id
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        r#"insert into user_recovery_code (user_id, code_hash)
           select $1, h from unnest($2::bytea[]) as h"#,
        user_id,
        code_hashes,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Accept a TOTP step at most once: a single atomic update that only moves
/// `last_used_step` forward on a confirmed row. `true` when this call won.
pub async fn use_totp_step(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    step: i64,
) -> Result<bool, CoreError> {
    let res = sqlx::query!(
        r#"update user_totp set last_used_step = $2
           where user_id = $1 and confirmed_at is not null
             and (last_used_step is null or last_used_step < $2)"#,
        user_id,
        step,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// Remove TOTP and every recovery code in one transaction. `true` when a TOTP
/// row existed.
pub async fn delete_totp(pool: &sqlx::PgPool, user_id: Uuid) -> Result<bool, CoreError> {
    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"delete from user_recovery_code where user_id = $1"#,
        user_id
    )
    .execute(&mut *tx)
    .await?;
    let res = sqlx::query!(r#"delete from user_totp where user_id = $1"#, user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(res.rows_affected() == 1)
}

/// Replace the user's recovery codes (used or not) with `code_hashes`, in one
/// transaction.
pub async fn replace_recovery_codes(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    code_hashes: &[Vec<u8>],
) -> Result<(), CoreError> {
    let mut tx = pool.begin().await?;
    write_codes(&mut tx, user_id, code_hashes).await?;
    tx.commit().await?;
    Ok(())
}

/// Spend an unused recovery code: one atomic mark-used, so a code works once
/// even under concurrent requests. `Some(remaining unused)` on success, `None`
/// when no unused code matches.
pub async fn use_recovery_code(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    code_hash: &[u8],
) -> Result<Option<i64>, CoreError> {
    let mut tx = pool.begin().await?;
    let res = sqlx::query!(
        r#"update user_recovery_code set used_at = now()
           where id = (select id from user_recovery_code
                       where user_id = $1 and code_hash = $2 and used_at is null
                       limit 1)
             and used_at is null"#,
        user_id,
        code_hash,
    )
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() != 1 {
        return Ok(None);
    }
    let remaining = sqlx::query_scalar!(
        r#"select count(*) as "n!" from user_recovery_code
           where user_id = $1 and used_at is null"#,
        user_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(remaining))
}

pub struct Status {
    pub totp: bool,
    pub recovery_remaining: i64,
    pub passkeys: i64,
}

/// What the user has set up. `totp` counts only a confirmed row.
pub async fn status(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Status, CoreError> {
    let row = sqlx::query_as!(
        Status,
        r#"select
             exists (select 1 from user_totp
                     where user_id = $1 and confirmed_at is not null) as "totp!",
             (select count(*) from user_recovery_code
              where user_id = $1 and used_at is null) as "recovery_remaining!",
             (select count(*) from user_passkey where user_id = $1) as "passkeys!""#,
        user_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// Two-factor is on when a confirmed TOTP or at least one passkey exists.
pub fn has_second_factor(s: &Status) -> bool {
    s.totp || s.passkeys > 0
}

pub struct Cleared {
    pub totp: u64,
    pub recovery_codes: u64,
    pub passkeys: u64,
}

impl Cleared {
    pub fn any(&self) -> bool {
        self.totp + self.recovery_codes + self.passkeys > 0
    }
}

/// Delete every second factor of the user and report how many rows went from
/// each table. Takes a connection so a caller can run it inside its own
/// transaction (password reset, CLI).
pub async fn clear_all(conn: &mut sqlx::PgConnection, user_id: Uuid) -> Result<Cleared, CoreError> {
    let totp = sqlx::query!(r#"delete from user_totp where user_id = $1"#, user_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    let recovery_codes = sqlx::query!(
        r#"delete from user_recovery_code where user_id = $1"#,
        user_id
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    let passkeys = sqlx::query!(r#"delete from user_passkey where user_id = $1"#, user_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    Ok(Cleared {
        totp,
        recovery_codes,
        passkeys,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    async fn seed_user(pool: &PgPool, email: &str) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, $2, 'U', 'h', 'user')",
        )
        .bind(id)
        .bind(email)
        .execute(pool)
        .await
        .unwrap();
        id
    }

    fn codes(n: u8) -> Vec<Vec<u8>> {
        (0..n).map(|i| vec![i]).collect()
    }

    async fn add_passkey(pool: &PgPool, user: Uuid, cred: &[u8]) {
        sqlx::query(
            "insert into user_passkey (user_id, credential_id, passkey, name) \
             values ($1, $2, '{}', 'k')",
        )
        .bind(user)
        .bind(cred)
        .execute(pool)
        .await
        .unwrap();
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn upsert_replaces_unconfirmed_not_confirmed(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        assert!(upsert_unconfirmed_totp(&pool, u, "one").await.unwrap());
        assert!(upsert_unconfirmed_totp(&pool, u, "two").await.unwrap());
        let row = totp(&pool, u).await.unwrap().unwrap();
        assert_eq!(row.secret_enc, "two");
        assert!(!row.confirmed);

        assert!(confirm_totp(&pool, u, 5, &codes(10)).await.unwrap());
        assert!(!upsert_unconfirmed_totp(&pool, u, "three").await.unwrap());
        let row = totp(&pool, u).await.unwrap().unwrap();
        assert_eq!(row.secret_enc, "two");
        assert!(row.confirmed);
        assert_eq!(row.last_used_step, Some(5));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn confirm_needs_unconfirmed_row(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        assert!(!confirm_totp(&pool, u, 1, &codes(3)).await.unwrap());
        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        assert!(confirm_totp(&pool, u, 1, &codes(3)).await.unwrap());
        assert!(!confirm_totp(&pool, u, 2, &codes(3)).await.unwrap());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn totp_step_only_moves_forward(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        assert!(
            !use_totp_step(&pool, u, 10).await.unwrap(),
            "unconfirmed row never accepts a step"
        );
        confirm_totp(&pool, u, 1, &codes(1)).await.unwrap();
        assert!(use_totp_step(&pool, u, 10).await.unwrap());
        assert!(!use_totp_step(&pool, u, 10).await.unwrap());
        assert!(!use_totp_step(&pool, u, 9).await.unwrap());
        assert!(use_totp_step(&pool, u, 11).await.unwrap());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn recovery_code_is_single_use(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        replace_recovery_codes(&pool, u, &codes(10)).await.unwrap();
        assert_eq!(use_recovery_code(&pool, u, &[0]).await.unwrap(), Some(9));
        assert_eq!(use_recovery_code(&pool, u, &[0]).await.unwrap(), None);
        assert_eq!(use_recovery_code(&pool, u, &[99]).await.unwrap(), None);
        assert_eq!(use_recovery_code(&pool, u, &[1]).await.unwrap(), Some(8));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn replace_drops_old_codes(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        replace_recovery_codes(&pool, u, &codes(10)).await.unwrap();
        replace_recovery_codes(&pool, u, &[vec![200], vec![201]])
            .await
            .unwrap();
        assert_eq!(use_recovery_code(&pool, u, &[0]).await.unwrap(), None);
        assert_eq!(use_recovery_code(&pool, u, &[200]).await.unwrap(), Some(1));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn status_counts(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let s = status(&pool, u).await.unwrap();
        assert!(!s.totp && s.recovery_remaining == 0 && s.passkeys == 0);
        assert!(!has_second_factor(&s));

        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        assert!(!status(&pool, u).await.unwrap().totp);
        confirm_totp(&pool, u, 1, &codes(10)).await.unwrap();
        use_recovery_code(&pool, u, &[0]).await.unwrap();
        let s = status(&pool, u).await.unwrap();
        assert!(s.totp);
        assert_eq!(s.recovery_remaining, 9);
        assert!(has_second_factor(&s));

        delete_totp(&pool, u).await.unwrap();
        add_passkey(&pool, u, &[7]).await;
        let s = status(&pool, u).await.unwrap();
        assert_eq!(s.passkeys, 1);
        assert!(has_second_factor(&s));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_totp_removes_codes(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        assert!(!delete_totp(&pool, u).await.unwrap());
        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        confirm_totp(&pool, u, 1, &codes(10)).await.unwrap();
        assert!(delete_totp(&pool, u).await.unwrap());
        assert!(totp(&pool, u).await.unwrap().is_none());
        assert_eq!(status(&pool, u).await.unwrap().recovery_remaining, 0);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn clear_all_counts_and_isolates(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let other = seed_user(&pool, "b@t.local").await;
        for who in [u, other] {
            upsert_unconfirmed_totp(&pool, who, "s").await.unwrap();
            confirm_totp(&pool, who, 1, &codes(10)).await.unwrap();
        }
        add_passkey(&pool, u, &[1]).await;
        add_passkey(&pool, u, &[2]).await;
        add_passkey(&pool, other, &[3]).await;

        let mut conn = pool.acquire().await.unwrap();
        let cleared = clear_all(&mut conn, u).await.unwrap();
        drop(conn);
        assert_eq!(cleared.totp, 1);
        assert_eq!(cleared.recovery_codes, 10);
        assert_eq!(cleared.passkeys, 2);
        assert!(cleared.any());

        assert!(!has_second_factor(&status(&pool, u).await.unwrap()));
        let s = status(&pool, other).await.unwrap();
        assert!(s.totp);
        assert_eq!(s.recovery_remaining, 10);
        assert_eq!(s.passkeys, 1);

        let mut conn = pool.acquire().await.unwrap();
        assert!(!clear_all(&mut conn, u).await.unwrap().any());
    }
}
