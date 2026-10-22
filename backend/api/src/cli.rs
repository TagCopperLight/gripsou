//! Operator commands run by the `gripsou` binary instead of the server.

/// `gripsou reset-2fa <email>`: turn off every second factor of that user and
/// sign them out everywhere. Returns the process exit code.
pub async fn reset_two_factor(db: &sqlx::PgPool, email: Option<String>) -> i32 {
    let Some(email) = email else {
        eprintln!("usage: gripsou reset-2fa <email>");
        return 2;
    };
    let user = match gripsou_core::repo::user::credentials_by_email(db, &email).await {
        Ok(user) => user,
        Err(e) => {
            tracing::error!(error = %gripsou_core::logs::error_chain(&e), "second factor reset failed");
            eprintln!("could not look up the user");
            return 1;
        }
    };
    let Some(user) = user else {
        eprintln!("no user with that email");
        return 1;
    };
    match gripsou_core::repo::mfa::reset_for_email(db, &email).await {
        Ok(Some((cleared, sessions))) => {
            if cleared.any() {
                tracing::info!(user_id = %user.id, reason = "cli", "second factors cleared");
            }
            println!(
                "removed: authenticator {}, backup codes {}, passkeys {}, sessions {}",
                cleared.totp, cleared.recovery_codes, cleared.passkeys, sessions
            );
            0
        }
        Ok(None) => {
            eprintln!("no user with that email");
            1
        }
        Err(e) => {
            tracing::error!(error = %gripsou_core::logs::error_chain(&e), "second factor reset failed");
            eprintln!("could not reset the second factors");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::reset_two_factor;
    use sqlx::PgPool;
    use uuid::Uuid;

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

    /// The `second factors cleared` line is written only when something was.
    #[sqlx::test(migrations = "../migrations")]
    async fn logs_only_when_something_was_cleared(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(100);
        let plain = seed_user(&pool, "plain@t.local").await;
        let with = seed_user(&pool, "with@t.local").await;
        gripsou_core::repo::mfa::upsert_unconfirmed_totp(&pool, with, "s")
            .await
            .unwrap();
        assert_eq!(
            reset_two_factor(&pool, Some("plain@t.local".into())).await,
            0
        );
        assert_eq!(
            reset_two_factor(&pool, Some("with@t.local".into())).await,
            0
        );
        assert_eq!(
            reset_two_factor(&pool, Some("none@t.local".into())).await,
            1
        );
        assert_eq!(reset_two_factor(&pool, None).await, 2);
        writer.flush(&pool).await;
        let users: Vec<String> = sqlx::query_scalar(
            "select fields->>'user_id' from log where message = 'second factors cleared'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(users, vec![with.to_string()]);
        assert!(!users.contains(&plain.to_string()));
    }
}
