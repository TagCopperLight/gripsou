//! The signed-in user's preferences. A currency change needs a rate into the
//! new currency, and switching AI categorisation on starts a run.

use axum::Json;
use axum::extract::State;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::dto;
use crate::error::ApiError;
use gripsou_core::repo::{prefs, user};

/// Saves only the settings in the body (see `prefs::patch_prefs`), so two
/// settings changed at once never overwrite each other.
///
/// A new currency is only saved once a rate into it is stored: figures are
/// converted at read time, and without one they are left out. The rate is
/// fetched now rather than at the next sync, and when it can't be had the
/// change is refused and nothing in the body is saved.
pub async fn update_prefs(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Json(patch): Json<serde_json::Map<String, serde_json::Value>>,
) -> Result<Json<dto::SessionUser>, ApiError> {
    let before = prefs::get(&pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    if let Some(currency) = patch.get("currency").and_then(|v| v.as_str())
        && prefs::valid_currency(currency)
        && currency != before.currency
    {
        fetch_reporting_rate(&pool, &jobs, user_id, currency).await?;
    }
    match prefs::patch_prefs(&pool, user_id, &patch).await {
        Ok(true) => {}
        Ok(false) => return Err(ApiError::Unauthorized),
        Err(prefs::PrefsError::Invalid(msg)) => return Err(ApiError::BadRequest(msg)),
        Err(prefs::PrefsError::NoRate(currency)) => {
            tracing::warn!(user_id = %user_id, currency, "currency change refused: no rate");
            return Err(ApiError::BadGateway(format!(
                "no exchange rate into {currency} right now"
            )));
        }
        Err(prefs::PrefsError::Core(e)) => return Err(ApiError::internal(e)),
    }
    let profile = user::profile_by_id(&pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let (was_enabled, enabled) = (before.budget_ai_enabled, profile.prefs.budget_ai_enabled);
    if enabled != was_enabled {
        tracing::info!(user_id = %user_id, enabled, "ai opt-in changed");
    }
    if enabled && !was_enabled {
        gripsou_jobs::request_categorize(pool.clone(), user_id);
    }
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

/// How long a currency change waits for its rate before giving up.
const RATE_FETCH_LIMIT: std::time::Duration = std::time::Duration::from_secs(10);

/// Fetches the rate into `currency` (see `update_prefs`). A provider failure
/// or a fetch past `RATE_FETCH_LIMIT` stores nothing; `patch_prefs` then
/// decides on the rates already stored.
async fn fetch_reporting_rate(
    pool: &PgPool,
    jobs: &gripsou_jobs::Deps,
    user_id: Uuid,
    currency: &str,
) -> Result<(), ApiError> {
    let fetch = gripsou_core::price_sync::ensure_fx_rate(pool, &jobs.prices, currency);
    if let Ok(ready) = tokio::time::timeout(RATE_FETCH_LIMIT, fetch).await
        && ready?
    {
        tracing::info!(user_id = %user_id, currency, "reporting rate ready");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;
    use axum::http::StatusCode;
    use rust_decimal::Decimal;
    use serde_json::json;

    async fn patch_prefs(
        pool: &PgPool,
        user_id: Uuid,
        patch: serde_json::Value,
    ) -> Result<dto::SessionUser, ApiError> {
        patch_prefs_with_rate(pool, user_id, patch, Some(Decimal::new(92, 2))).await
    }

    /// `rate: None` stands for the rate provider failing.
    async fn patch_prefs_with_rate(
        pool: &PgPool,
        user_id: Uuid,
        patch: serde_json::Value,
        rate: Option<Decimal>,
    ) -> Result<dto::SessionUser, ApiError> {
        let serde_json::Value::Object(patch) = patch else {
            panic!("a patch is an object")
        };
        let mut deps = gripsou_jobs::Deps::build(
            gripsou_core::testkit::encryption_key(),
            "EUR".into(),
            "http://localhost:5173".into(),
        );
        deps.prices = vec![Box::new(gripsou_core::testkit::FixedRateProvider { rate })];
        update_prefs(
            State(pool.clone()),
            State(std::sync::Arc::new(deps)),
            AuthUser {
                user_id,
                session_id: Uuid::new_v4(),
            },
            Json(patch),
        )
        .await
        .map(|Json(user)| user)
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_prefs_saves_only_the_settings_sent(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let updated = patch_prefs(
            &pool,
            user_id,
            json!({ "uiLanguage": "fr", "currency": "USD" }),
        )
        .await
        .unwrap();
        assert_eq!(updated.prefs.display.ui_language, "fr");
        assert_eq!(updated.prefs.currency, "USD");

        patch_prefs(&pool, user_id, json!({ "timeZone": "America/Los_Angeles" }))
            .await
            .unwrap();
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(
            (after.display.ui_language.as_str(), after.currency.as_str()),
            ("fr", "USD")
        );
        assert_eq!(after.time_zone, "America/Los_Angeles");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_new_currency_fetches_its_rate_before_saving(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        patch_prefs(&pool, user_id, json!({ "currency": "USD" }))
            .await
            .unwrap();
        let rates: i64 = sqlx::query_scalar(
            "select count(*) from price p join instrument i on i.id = p.instrument_id \
             where i.kind = 'cash' and i.currency = 'USD'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rates, 1);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_currency_with_no_rate_is_refused_and_nothing_saved(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let err = patch_prefs_with_rate(
            &pool,
            user_id,
            json!({ "currency": "USD", "uiLanguage": "fr" }),
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_GATEWAY);
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(after.currency, "EUR");
        assert_ne!(after.display.ui_language, "fr");

        // The pivot needs no rate, so going back to it never depends on one.
        patch_prefs(&pool, user_id, json!({ "currency": "USD" }))
            .await
            .unwrap();
        patch_prefs_with_rate(&pool, user_id, json!({ "currency": "EUR" }), None)
            .await
            .unwrap();
        assert_eq!(prefs_of(&pool, user_id).await.currency, "EUR");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn two_settings_saved_at_once_both_stick(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let (a, b) = tokio::join!(
            patch_prefs(&pool, user_id, json!({ "currency": "USD" })),
            patch_prefs(&pool, user_id, json!({ "numberDecimals": 0 })),
        );
        a.unwrap();
        b.unwrap();
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(
            (after.currency.as_str(), after.display.number_decimals),
            ("USD", 0)
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_prefs_rejects_bad_values_without_writing(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "tz@example.com", "pw", "user").await;
        let before = prefs_of(&pool, user_id).await;
        let big = format!("data:image/webp;base64,{}", "A".repeat(200 * 1024));
        let bad = [
            json!({ "timeZone": "" }),
            json!({ "timeZone": "Europe/NotAPlace" }),
            json!({ "timeZone": "+02:00" }),
            json!({ "timeZone": "posix/Europe/Paris" }),
            json!({ "currency": "usd" }),
            json!({ "currency": "EURO" }),
            json!({ "currency": null }),
            json!({ "budgetAiThreshold": 40 }),
            json!({ "numberDecimals": "two" }),
            json!({ "avatar": "data:text/html,<script>" }),
            json!({ "avatar": big }),
            json!({ "uiLanguage": "fr", "noSuchPref": true }),
        ];
        for patch in bad {
            let label = patch.to_string();
            let result = patch_prefs(&pool, user_id, patch).await;
            assert!(matches!(result, Err(ApiError::BadRequest(_))), "{label}");
        }
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(
            serde_json::to_value(&after).unwrap(),
            serde_json::to_value(&before).unwrap()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_null_removes_the_avatar(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "av@example.com", "pw", "user").await;
        patch_prefs(
            &pool,
            user_id,
            json!({ "avatar": "data:image/webp;base64,UklGRg==" }),
        )
        .await
        .unwrap();
        assert!(prefs_of(&pool, user_id).await.display.avatar.is_some());
        patch_prefs(&pool, user_id, json!({ "avatar": null }))
            .await
            .unwrap();
        assert!(prefs_of(&pool, user_id).await.display.avatar.is_none());
    }

    async fn prefs_of(pool: &PgPool, user_id: Uuid) -> prefs::UserPrefs {
        user::profile_by_id(pool, user_id)
            .await
            .unwrap()
            .unwrap()
            .prefs
    }
}
