//! Second factors: TOTP secret, recovery codes and passkey counts.

use uuid::Uuid;

use crate::error::CoreError;

/// How long an unconfirmed setup can still be confirmed. Past it the row is
/// dead (and swept): a stolen session can't keep guessing codes against a
/// setup the owner abandoned.
pub const SETUP_TTL_MINUTES: i32 = 10;

pub struct TotpRow {
    pub secret_enc: String,
    pub confirmed: bool,
    pub last_used_step: Option<i64>,
    /// Unconfirmed and started less than [`SETUP_TTL_MINUTES`] ago.
    pub pending: bool,
}

/// The user's TOTP row, confirmed or not.
pub async fn totp(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Option<TotpRow>, CoreError> {
    let row = sqlx::query_as!(
        TotpRow,
        r#"select secret_enc, confirmed_at is not null as "confirmed!", last_used_step,
                  (confirmed_at is null
                   and created_at > now() - make_interval(mins => $2)) as "pending!"
           from user_totp where user_id = $1"#,
        user_id,
        SETUP_TTL_MINUTES,
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
/// the accepted `step`) and replaces the recovery codes. Only the row still
/// holding `secret_enc` (the secret the code was checked against) and started
/// less than [`SETUP_TTL_MINUTES`] ago is confirmed; `false`, with nothing
/// written, when there is no such unconfirmed row.
pub async fn confirm_totp(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    secret_enc: &str,
    step: i64,
    code_hashes: &[Vec<u8>],
) -> Result<bool, CoreError> {
    let mut tx = pool.begin().await?;
    let res = sqlx::query!(
        r#"update user_totp set confirmed_at = now(), last_used_step = $2
           where user_id = $1 and confirmed_at is null and secret_enc = $3
             and created_at > now() - make_interval(mins => $4)"#,
        user_id,
        step,
        secret_enc,
        SETUP_TTL_MINUTES,
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

/// Housekeeping: drop unconfirmed setups too old to be confirmed.
pub async fn delete_stale_setups(pool: &sqlx::PgPool) -> Result<u64, CoreError> {
    let res = sqlx::query!(
        r#"delete from user_totp
           where confirmed_at is null
             and created_at <= now() - make_interval(mins => $1)"#,
        SETUP_TTL_MINUTES,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Accept a TOTP step at most once: a single atomic update that only moves
/// `last_used_step` forward on a confirmed row. `true` when this call won.
pub async fn use_totp_step(
    db: impl sqlx::PgExecutor<'_>,
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
    .execute(db)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// Remove TOTP and every recovery code in one transaction. `true` only when a
/// confirmed TOTP existed; a pending (unconfirmed) setup is discarded too but
/// reports `false`.
pub async fn delete_totp(pool: &sqlx::PgPool, user_id: Uuid) -> Result<bool, CoreError> {
    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"delete from user_recovery_code where user_id = $1"#,
        user_id
    )
    .execute(&mut *tx)
    .await?;
    let confirmed = sqlx::query_scalar!(
        r#"delete from user_totp where user_id = $1
           returning confirmed_at is not null as "confirmed!""#,
        user_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(confirmed == Some(true))
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
/// when no unused code matches. Takes a connection so the caller can make it
/// part of its own transaction (login spends the challenge in the same one).
pub async fn use_recovery_code(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    code_hash: &[u8],
) -> Result<Option<i64>, CoreError> {
    let res = sqlx::query!(
        r#"update user_recovery_code set used_at = now()
           where id = (select id from user_recovery_code
                       where user_id = $1 and code_hash = $2 and used_at is null
                       limit 1)
             and used_at is null"#,
        user_id,
        code_hash,
    )
    .execute(&mut *conn)
    .await?;
    if res.rows_affected() != 1 {
        return Ok(None);
    }
    let remaining = sqlx::query_scalar!(
        r#"select count(*) as "n!" from user_recovery_code
           where user_id = $1 and used_at is null"#,
        user_id,
    )
    .fetch_one(&mut *conn)
    .await?;
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

/// Two-factor is on when a confirmed authenticator exists. Passkeys are a way
/// to sign in, not a second step: they never turn it on.
pub fn has_second_factor(s: &Status) -> bool {
    s.totp
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

/// Operator escape hatch: turn off every second factor of the user with this
/// email and sign them out everywhere, in one transaction. `None` when no such
/// user exists; otherwise what was removed and how many sessions ended.
pub async fn reset_for_email(
    pool: &sqlx::PgPool,
    email: &str,
) -> Result<Option<(Cleared, u64)>, CoreError> {
    let mut tx = pool.begin().await?;
    let Some(user_id) = sqlx::query_scalar!(r#"select id from users where email = $1"#, email)
        .fetch_optional(&mut *tx)
        .await?
    else {
        return Ok(None);
    };
    let cleared = clear_all(&mut tx, user_id).await?;
    let sessions = sqlx::query!(r#"delete from session where user_id = $1"#, user_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    tx.commit().await?;
    Ok(Some((cleared, sessions)))
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

    #[sqlx::test(migrations = "../migrations")]
    async fn confirm_with_a_stale_secret_changes_nothing(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        upsert_unconfirmed_totp(&pool, u, "a").await.unwrap();
        upsert_unconfirmed_totp(&pool, u, "b").await.unwrap();
        assert!(!confirm_totp(&pool, u, "a", 1, &codes(3)).await.unwrap());
        let st = status(&pool, u).await.unwrap();
        assert!(!st.totp);
        assert_eq!(st.recovery_remaining, 0);
        assert!(confirm_totp(&pool, u, "b", 1, &codes(3)).await.unwrap());
    }

    async fn age_setup(pool: &PgPool, user: Uuid, minutes: i32) {
        sqlx::query(
            "update user_totp set created_at = now() - make_interval(mins => $2) \
             where user_id = $1",
        )
        .bind(user)
        .bind(minutes)
        .execute(pool)
        .await
        .unwrap();
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_setup_older_than_ten_minutes_cannot_be_confirmed(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        assert!(totp(&pool, u).await.unwrap().unwrap().pending);
        age_setup(&pool, u, 11).await;
        assert!(!totp(&pool, u).await.unwrap().unwrap().pending);
        assert!(!confirm_totp(&pool, u, "s", 1, &codes(3)).await.unwrap());
        // Starting again resets the clock.
        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        assert!(totp(&pool, u).await.unwrap().unwrap().pending);
        assert!(confirm_totp(&pool, u, "s", 1, &codes(3)).await.unwrap());
        assert!(!totp(&pool, u).await.unwrap().unwrap().pending);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn the_sweep_drops_only_stale_unconfirmed_setups(pool: PgPool) {
        let stale = seed_user(&pool, "a@t.local").await;
        let fresh = seed_user(&pool, "b@t.local").await;
        let done = seed_user(&pool, "c@t.local").await;
        for u in [stale, fresh, done] {
            upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        }
        confirm_totp(&pool, done, "s", 1, &codes(1)).await.unwrap();
        age_setup(&pool, stale, 11).await;
        age_setup(&pool, done, 60).await;
        assert_eq!(delete_stale_setups(&pool).await.unwrap(), 1);
        assert!(totp(&pool, stale).await.unwrap().is_none());
        assert!(totp(&pool, fresh).await.unwrap().is_some());
        assert!(totp(&pool, done).await.unwrap().is_some());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_discards_a_pending_setup_but_reports_false(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        upsert_unconfirmed_totp(&pool, u, "a").await.unwrap();
        assert!(!delete_totp(&pool, u).await.unwrap());
        assert!(totp(&pool, u).await.unwrap().is_none());
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

        assert!(confirm_totp(&pool, u, "two", 5, &codes(10)).await.unwrap());
        assert!(!upsert_unconfirmed_totp(&pool, u, "three").await.unwrap());
        let row = totp(&pool, u).await.unwrap().unwrap();
        assert_eq!(row.secret_enc, "two");
        assert!(row.confirmed);
        assert_eq!(row.last_used_step, Some(5));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn confirm_needs_unconfirmed_row(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        assert!(!confirm_totp(&pool, u, "s", 1, &codes(3)).await.unwrap());
        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        assert!(confirm_totp(&pool, u, "s", 1, &codes(3)).await.unwrap());
        assert!(!confirm_totp(&pool, u, "s", 2, &codes(3)).await.unwrap());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn totp_step_only_moves_forward(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        assert!(
            !use_totp_step(&pool, u, 10).await.unwrap(),
            "unconfirmed row never accepts a step"
        );
        confirm_totp(&pool, u, "s", 1, &codes(1)).await.unwrap();
        assert!(use_totp_step(&pool, u, 10).await.unwrap());
        assert!(!use_totp_step(&pool, u, 10).await.unwrap());
        assert!(!use_totp_step(&pool, u, 9).await.unwrap());
        assert!(use_totp_step(&pool, u, 11).await.unwrap());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn recovery_code_is_single_use(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        replace_recovery_codes(&pool, u, &codes(10)).await.unwrap();
        assert_eq!(
            use_recovery_code(&mut pool.acquire().await.unwrap(), u, &[0])
                .await
                .unwrap(),
            Some(9)
        );
        assert_eq!(
            use_recovery_code(&mut pool.acquire().await.unwrap(), u, &[0])
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            use_recovery_code(&mut pool.acquire().await.unwrap(), u, &[99])
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            use_recovery_code(&mut pool.acquire().await.unwrap(), u, &[1])
                .await
                .unwrap(),
            Some(8)
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn replace_drops_old_codes(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        replace_recovery_codes(&pool, u, &codes(10)).await.unwrap();
        replace_recovery_codes(&pool, u, &[vec![200], vec![201]])
            .await
            .unwrap();
        assert_eq!(
            use_recovery_code(&mut pool.acquire().await.unwrap(), u, &[0])
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            use_recovery_code(&mut pool.acquire().await.unwrap(), u, &[200])
                .await
                .unwrap(),
            Some(1)
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn status_counts(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let s = status(&pool, u).await.unwrap();
        assert!(!s.totp && s.recovery_remaining == 0 && s.passkeys == 0);
        assert!(!has_second_factor(&s));

        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        assert!(!status(&pool, u).await.unwrap().totp);
        confirm_totp(&pool, u, "s", 1, &codes(10)).await.unwrap();
        use_recovery_code(&mut pool.acquire().await.unwrap(), u, &[0])
            .await
            .unwrap();
        let s = status(&pool, u).await.unwrap();
        assert!(s.totp);
        assert_eq!(s.recovery_remaining, 9);
        assert!(has_second_factor(&s));

        delete_totp(&pool, u).await.unwrap();
        add_passkey(&pool, u, &[7]).await;
        let s = status(&pool, u).await.unwrap();
        assert_eq!(s.passkeys, 1);
        assert!(!has_second_factor(&s), "a passkey alone is not two-factor");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_totp_removes_codes(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        assert!(!delete_totp(&pool, u).await.unwrap());
        upsert_unconfirmed_totp(&pool, u, "s").await.unwrap();
        confirm_totp(&pool, u, "s", 1, &codes(10)).await.unwrap();
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
            confirm_totp(&pool, who, "s", 1, &codes(10)).await.unwrap();
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

    #[sqlx::test(migrations = "../migrations")]
    async fn reset_for_email_clears_and_signs_out(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let other = seed_user(&pool, "b@t.local").await;
        for who in [u, other] {
            upsert_unconfirmed_totp(&pool, who, "s").await.unwrap();
            confirm_totp(&pool, who, "s", 1, &codes(3)).await.unwrap();
            sqlx::query(
                "insert into session (user_id, token_hash, remembered, expires_at) \
                 values ($1, decode('00','hex') || $1::text::bytea, false, now() + interval '1 day')",
            )
            .bind(who)
            .execute(&pool)
            .await
            .unwrap();
        }
        add_passkey(&pool, u, &[1]).await;

        let (cleared, sessions) = reset_for_email(&pool, "a@t.local").await.unwrap().unwrap();
        assert_eq!(
            (cleared.totp, cleared.recovery_codes, cleared.passkeys),
            (1, 3, 1)
        );
        assert_eq!(sessions, 1);
        assert!(!has_second_factor(&status(&pool, u).await.unwrap()));
        assert!(has_second_factor(&status(&pool, other).await.unwrap()));
        let left: i64 = sqlx::query_scalar("select count(*) from session")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, 1);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn reset_for_email_unknown_is_none(pool: PgPool) {
        assert!(
            reset_for_email(&pool, "nobody@t.local")
                .await
                .unwrap()
                .is_none()
        );
    }
}
