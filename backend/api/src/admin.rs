//! Admin-only settings: account providers, the budget AI and its prices,
//! users, invites and reset links.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::{Duration, Utc};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{self, AdminUser};
use crate::dto;
use crate::error::ApiError;

pub async fn providers(
    State(pool): State<PgPool>,
    _: AdminUser,
) -> Result<Json<Vec<dto::Provider>>, ApiError> {
    let enabled = gripsou_core::repo::provider::enabled(&pool).await?;
    Ok(Json(
        gripsou_jobs::ACCOUNT_PROVIDERS
            .iter()
            .map(|k| dto::Provider::new(k, enabled.iter().any(|e| e == k.key)))
            .collect(),
    ))
}

pub async fn budget_ai_settings(
    State(pool): State<PgPool>,
    _: AdminUser,
) -> Result<Json<dto::BudgetAiSettingsDto>, ApiError> {
    let s = gripsou_core::repo::settings::budget_ai(&pool).await?;
    let defaults = gripsou_jobs::categorizer_keys()
        .into_iter()
        .filter_map(|k| gripsou_jobs::default_model(k).map(|m| (k, m)))
        .collect();
    Ok(Json(dto::BudgetAiSettingsDto {
        provider: s.provider,
        model: s.model,
        available: gripsou_jobs::available_categorizers(),
        defaults,
    }))
}

pub async fn set_budget_ai_settings(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Json(body): Json<dto::SetBudgetAiSettingsReq>,
) -> Result<StatusCode, ApiError> {
    let provider = body
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty());
    if provider.is_some_and(|p| !gripsou_jobs::categorizer_keys().contains(&p)) {
        return Err(ApiError::bad_request("unknown provider"));
    }
    let model = body
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty());
    gripsou_core::repo::settings::set_budget_ai(&pool, provider, model).await?;
    tracing::info!(
        by = %user_id,
        provider = provider.unwrap_or(""),
        model = model.unwrap_or(""),
        "ai settings changed"
    );
    Ok(StatusCode::NO_CONTENT)
}

/// The models the provider offers, for the admin's model dropdown. Asked of
/// the provider on every call: the list is short and only read by an admin.
pub async fn budget_ai_models(
    _: AdminUser,
    Path(provider): Path<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    if !gripsou_jobs::categorizer_keys().contains(&provider.as_str()) {
        return Err(ApiError::NotFound("unknown provider"));
    }
    match gripsou_jobs::categorizer_models(&provider).await {
        Some(Ok(models)) => Ok(Json(models)),
        Some(Err(e)) => {
            tracing::warn!(provider = %provider, error = %gripsou_core::logs::error_chain(&e), "ai model list failed");
            Err(ApiError::BadGateway(e.to_string()))
        }
        None => Err(ApiError::Conflict("provider has no API key on this server")),
    }
}

pub async fn budget_ai_usage(
    State(pool): State<PgPool>,
    _: AdminUser,
) -> Result<Json<dto::BudgetAiUsageDto>, ApiError> {
    let report = gripsou_core::budget::ai_cost::usage_report(&pool).await?;
    let money = |d: Decimal| d.round_dp(4).normalize().to_string();
    Ok(Json(dto::BudgetAiUsageDto {
        currency: "USD",
        models: report
            .models
            .into_iter()
            .map(|m| dto::BudgetAiModelUsageDto {
                model: m.model,
                runs: m.runs,
                runs_without_usage: m.runs_without_usage,
                tokens_in: m.tokens_in,
                tokens_out: m.tokens_out,
                price_in: m.price.as_ref().map(|p| p.input.to_string()),
                price_out: m.price.as_ref().map(|p| p.output.to_string()),
                cost: m.cost.map(money),
            })
            .collect(),
        total_cost: money(report.total_cost),
    }))
}

/// Replaces the whole price map. Every value must be a non-negative decimal
/// string (USD per million tokens); anything else is a 400 and saves nothing.
pub async fn set_budget_ai_prices(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Json(body): Json<std::collections::BTreeMap<String, dto::BudgetAiPriceReq>>,
) -> Result<StatusCode, ApiError> {
    let parse = |model: &str, v: &str| {
        v.trim()
            .parse::<Decimal>()
            .ok()
            .filter(|d| *d >= Decimal::ZERO)
            .map(|d| if d.is_zero() { Decimal::ZERO } else { d })
            .ok_or_else(|| ApiError::BadRequest(format!("invalid price for {model}: {v:?}")))
    };
    let mut prices = gripsou_core::repo::settings::ModelPrices::new();
    for (model, p) in &body {
        let model = model.trim();
        if model.is_empty() {
            return Err(ApiError::bad_request("empty model key"));
        }
        prices.insert(
            model.to_string(),
            gripsou_core::repo::settings::ModelPrice {
                input: parse(model, &p.input)?,
                output: parse(model, &p.output)?,
            },
        );
    }
    gripsou_core::repo::settings::set_budget_ai_prices(&pool, &prices).await?;
    tracing::info!(by = %user_id, models = prices.len() as u64, "ai prices changed");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn set_provider(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Path(key): Path<String>,
    Json(body): Json<dto::SetProviderReq>,
) -> Result<Json<dto::Provider>, ApiError> {
    // Reject unknown providers before mutating.
    let kind =
        gripsou_jobs::account_provider(&key).ok_or(ApiError::NotFound("provider not found"))?;
    gripsou_core::repo::provider::set_enabled(&pool, &key, body.enabled).await?;
    tracing::info!(by = %user_id, provider = %key, enabled = body.enabled, "provider enabled changed");
    Ok(Json(dto::Provider::new(kind, body.enabled)))
}

pub async fn users(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
) -> Result<Json<Vec<dto::User>>, ApiError> {
    // Listing every account (names/emails/roles) is admin-only.
    let rows = gripsou_core::repo::query::users(&pool).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| dto::User::from_row(r, user_id))
            .collect(),
    ))
}

pub async fn create_invite(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
) -> Result<(StatusCode, Json<dto::InviteLinkResp>), ApiError> {
    let raw = auth::generate_token();
    let stored = auth::hash_token_str(&raw);
    let expires_at = Utc::now() + Duration::hours(24);
    gripsou_core::repo::invite_token::create(&pool, "invite", None, user_id, &stored, expires_at)
        .await?;
    tracing::info!(by = %user_id, "invite created");
    Ok((
        StatusCode::CREATED,
        Json(dto::InviteLinkResp { token: raw }),
    ))
}

/// Redeeming a reset link clears the target's second factors, so creating one
/// needs a fresh reauth token, and never for oneself (Settings changes one's
/// own password): a stolen admin session must not get past two-factor.
pub async fn create_reset_link(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::ReauthTokenReq>,
) -> Result<(StatusCode, Json<dto::InviteLinkResp>), ApiError> {
    if id == user_id {
        return Err(ApiError::bad_request(
            "cannot create a reset link for yourself",
        ));
    }
    let target = gripsou_core::repo::user::profile_by_id(&pool, id)
        .await?
        .ok_or(ApiError::NotFound("user not found"))?;
    crate::auth::mfa::require_reauth(&pool, user_id, &body.reauth).await?;
    let raw = auth::generate_token();
    let stored = auth::hash_token_str(&raw);
    let expires_at = Utc::now() + Duration::hours(24);
    gripsou_core::repo::invite_token::create(
        &pool,
        "reset",
        Some(&target.email),
        user_id,
        &stored,
        expires_at,
    )
    .await?;
    tracing::info!(by = %user_id, target_user_id = %id, "reset link created");
    Ok((
        StatusCode::CREATED,
        Json(dto::InviteLinkResp { token: raw }),
    ))
}

pub async fn delete_user(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::DeleteUserReq>,
) -> Result<StatusCode, ApiError> {
    let target = gripsou_core::repo::user::profile_by_id(&pool, id)
        .await?
        .ok_or(ApiError::NotFound("user not found"))?;
    // Confirm the typed email matches the user being deleted (case-insensitive).
    if body.email.trim().to_lowercase() != target.email.to_lowercase() {
        return Err(ApiError::bad_request("email does not match user"));
    }
    // Refuse to delete the last admin: it would lock everyone out of admin-only settings.
    if target.role == "admin" && gripsou_core::repo::user::count_admins(&pool).await? <= 1 {
        return Err(ApiError::Conflict("cannot delete the last admin"));
    }
    gripsou_core::repo::user::delete_user(&pool, id).await?;
    tracing::info!(by = %user_id, target_user_id = %id, "user deleted");
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;
    use sqlx::PgPool;

    #[sqlx::test(migrations = "../migrations")]
    async fn providers_lists_account_providers_with_enabled_flag(pool: PgPool) {
        // powens is enabled via seed.
        let admin = seed_user_with_password(&pool, "admin@t.local", "pw", "admin").await;
        let principal = AdminUser { user_id: admin };

        let list = providers(State(pool.clone()), principal)
            .await
            .expect("ok")
            .0;

        assert_eq!(list.len(), 1, "only account providers are listed");
        assert_eq!(list[0].key, "powens");
        assert_eq!(list[0].display_name, "Powens");
        assert!(list[0].enabled, "powens is in the seeded enabled_providers");
        assert!(!list[0].description.is_empty());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn set_provider_toggles_enabled_idempotently(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "admin@t.local", "pw", "admin").await;
        let principal = || AdminUser { user_id: admin };

        // Disable powens (seeded enabled).
        let off = set_provider(
            State(pool.clone()),
            principal(),
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: false }),
        )
        .await
        .expect("disable ok")
        .0;
        assert!(!off.enabled);

        // Idempotent: disabling again still reports disabled and does not error.
        let _ = set_provider(
            State(pool.clone()),
            principal(),
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: false }),
        )
        .await
        .expect("second disable ok");

        // Re-enable.
        let on = set_provider(
            State(pool.clone()),
            principal(),
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: true }),
        )
        .await
        .expect("enable ok")
        .0;
        assert!(on.enabled);

        // Persisted: a fresh list reflects the enabled flag.
        let list = providers(State(pool.clone()), principal()).await.unwrap().0;
        assert!(list.iter().find(|p| p.key == "powens").unwrap().enabled);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn set_provider_unknown_key_is_404(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "admin@t.local", "pw", "admin").await;
        // 'yahoo' is a price provider, not an account provider: not found.
        for key in ["nope", "yahoo"] {
            let err = set_provider(
                State(pool.clone()),
                AdminUser { user_id: admin },
                Path(key.to_string()),
                Json(dto::SetProviderReq { enabled: true }),
            )
            .await
            .unwrap_err();
            assert_eq!(err.status(), StatusCode::NOT_FOUND, "key {key}");
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn create_invite_writes_invite_row(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;
        let resp = create_invite(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
        )
        .await
        .expect("ok");
        assert_eq!(resp.0, StatusCode::CREATED);
        assert!(!resp.1.0.token.is_empty());

        let (kind, email): (String, Option<String>) =
            sqlx::query_as("select type, email from invite_token where created_by = $1")
                .bind(admin)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(kind, "invite");
        assert_eq!(email, None);

        let stored_token: String =
            sqlx::query_scalar("select token from invite_token where created_by = $1")
                .bind(admin)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_ne!(stored_token, resp.1.0.token, "raw token must not be stored");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn create_reset_link_stores_target_email(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let target = seed_user_with_password(&pool, "target@t.local", "pw", "user").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;

        let reauth = crate::auth::mfa::tests::reauth_token(&pool, &who, "pw").await;
        let resp = create_reset_link(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(target),
            Json(dto::ReauthTokenReq { reauth }),
        )
        .await
        .expect("ok");
        assert_eq!(resp.0, StatusCode::CREATED);

        let (kind, email): (String, Option<String>) =
            sqlx::query_as("select type, email from invite_token where type = 'reset'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(kind, "reset");
        assert_eq!(email.as_deref(), Some("target@t.local"));

        let stored_token: String =
            sqlx::query_scalar("select token from invite_token where type = 'reset'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_ne!(stored_token, resp.1.0.token, "raw token must not be stored");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn create_reset_link_needs_a_reauth_and_another_user(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let target = seed_user_with_password(&pool, "target@t.local", "pw", "user").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;
        let create = |id, reauth: &str| {
            create_reset_link(
                State(pool.clone()),
                AdminUser {
                    user_id: who.user_id,
                },
                Path(id),
                Json(dto::ReauthTokenReq {
                    reauth: reauth.into(),
                }),
            )
        };

        let err = create(target, "forged").await.unwrap_err();
        assert_eq!(err.status(), StatusCode::FORBIDDEN);
        let reauth = crate::auth::mfa::tests::reauth_token(&pool, &who, "pw").await;
        let err = create(admin, &reauth).await.unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        // Refusing oneself did not spend the token.
        let (status, _) = create(target, &reauth).await.expect("ok");
        assert_eq!(status, StatusCode::CREATED);
        // Single use.
        let err = create(target, &reauth).await.unwrap_err();
        assert_eq!(err.status(), StatusCode::FORBIDDEN);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_user_rejects_mismatched_email(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let target = seed_user_with_password(&pool, "target@t.local", "pw", "user").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;

        let err = delete_user(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(target),
            Json(dto::DeleteUserReq {
                email: "wrong@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, target)
                .await
                .unwrap()
                .is_some()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_user_refuses_last_admin(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "boss@t.local", "pw", "admin").await;
        let who = principal_for(&pool, "boss@t.local", "pw").await;

        let err = delete_user(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(admin),
            Json(dto::DeleteUserReq {
                email: "boss@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::CONFLICT);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_user_removes_target(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let target = seed_user_with_password(&pool, "target@t.local", "pw", "user").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;

        // Case-insensitive email match succeeds.
        let ok = delete_user(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(target),
            Json(dto::DeleteUserReq {
                email: "TARGET@t.local".into(),
            }),
        )
        .await
        .expect("ok");
        assert_eq!(ok, StatusCode::NO_CONTENT);
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, target)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn budget_ai_models_rejects_unknown_provider(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let err = budget_ai_models(AdminUser { user_id: admin }, Path("nope".into()))
            .await
            .expect_err("not found");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
    }

    /// An admin's budget AI choice persists (trimmed) and reads back as written.
    #[sqlx::test(migrations = "../migrations")]
    async fn set_budget_ai_settings_persists(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let key = gripsou_jobs::categorizer_keys()[0];

        let status = set_budget_ai_settings(
            State(pool.clone()),
            AdminUser { user_id: admin },
            Json(dto::SetBudgetAiSettingsReq {
                provider: Some(format!("  {key} ")),
                model: Some(" some-model ".into()),
            }),
        )
        .await
        .expect("admin may set");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let read = budget_ai_settings(State(pool.clone()), AdminUser { user_id: admin })
            .await
            .expect("admin may read")
            .0;
        assert_eq!(read.provider.as_deref(), Some(key));
        assert_eq!(read.model.as_deref(), Some("some-model"));
    }

    /// Blank strings switch the AI off (stored as null), rather than storing a
    /// provider named "" that the scheduler would then try to look up.
    #[sqlx::test(migrations = "../migrations")]
    async fn set_budget_ai_settings_blank_clears(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let key = gripsou_jobs::categorizer_keys()[0];
        gripsou_core::repo::settings::set_budget_ai(&pool, Some(key), Some("m"))
            .await
            .unwrap();

        set_budget_ai_settings(
            State(pool.clone()),
            AdminUser { user_id: admin },
            Json(dto::SetBudgetAiSettingsReq {
                provider: Some("   ".into()),
                model: Some("".into()),
            }),
        )
        .await
        .expect("admin may clear");
        let s = gripsou_core::repo::settings::budget_ai(&pool)
            .await
            .unwrap();
        assert_eq!((s.provider, s.model), (None, None));
    }

    /// A provider key outside the registry is a 400 and leaves the previous
    /// choice in place, so a typo cannot silently disable categorisation.
    #[sqlx::test(migrations = "../migrations")]
    async fn set_budget_ai_settings_rejects_unknown_provider(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let key = gripsou_jobs::categorizer_keys()[0];
        gripsou_core::repo::settings::set_budget_ai(&pool, Some(key), Some("m"))
            .await
            .unwrap();

        let err = set_budget_ai_settings(
            State(pool.clone()),
            AdminUser { user_id: admin },
            Json(dto::SetBudgetAiSettingsReq {
                provider: Some("no-such-provider".into()),
                model: Some("other".into()),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        let s = gripsou_core::repo::settings::budget_ai(&pool)
            .await
            .unwrap();
        assert_eq!(s.provider.as_deref(), Some(key));
        assert_eq!(s.model.as_deref(), Some("m"));
    }

    // ── AI usage and prices ─────────────────────────────────────────────────

    use std::collections::BTreeMap;

    async fn seed(pool: &PgPool, role: &str) -> Uuid {
        let email = format!("{}@t.local", Uuid::new_v4());
        gripsou_core::testkit::seed_user_as(pool, &email, role, "x").await
    }

    fn who(user_id: Uuid) -> AdminUser {
        AdminUser { user_id }
    }

    fn price(i: &str, o: &str) -> dto::BudgetAiPriceReq {
        dto::BudgetAiPriceReq {
            input: i.into(),
            output: o.into(),
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn prices_then_usage(pool: PgPool) {
        let admin = seed(&pool, "admin").await;
        for (tin, tout, complete) in [(9_495_459_i64, 4_484_808_i64, true), (0, 0, false)] {
            sqlx::query(
                "insert into budget_ai_run \
                 (user_id, model, tokens_in, tokens_out, usage_complete, outcome) \
                 values ($1, 'jev:jev-latest', $2, $3, $4, 'ok')",
            )
            .bind(admin)
            .bind(tin)
            .bind(tout)
            .bind(complete)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "insert into budget_ai_run (user_id, model, tokens_in, tokens_out, outcome) \
             values ($1, 'alpha:x', 10, 10, 'ok')",
        )
        .bind(admin)
        .execute(&pool)
        .await
        .unwrap();

        let status = set_budget_ai_prices(
            State(pool.clone()),
            who(admin),
            Json(BTreeMap::from([
                ("jev:jev-latest".to_string(), price("0.042", "0")),
                ("unused:m".to_string(), price("1", "1")),
            ])),
        )
        .await
        .expect("prices saved");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let v = serde_json::to_value(
            budget_ai_usage(State(pool.clone()), who(admin))
                .await
                .expect("usage")
                .0,
        )
        .unwrap();
        // 9.495459 * 0.042 = 0.398809278 → 0.3988
        assert_eq!(
            v,
            serde_json::json!({
                "currency": "USD",
                "models": [
                    {"model": "alpha:x", "runs": 1, "runsWithoutUsage": 0,
                     "tokensIn": 10, "tokensOut": 10,
                     "priceIn": null, "priceOut": null, "cost": null},
                    {"model": "jev:jev-latest", "runs": 2, "runsWithoutUsage": 1,
                     "tokensIn": 9495459, "tokensOut": 4484808,
                     "priceIn": "0.042", "priceOut": "0", "cost": "0.3988"}
                ],
                "totalCost": "0.3988"
            })
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn usage_with_no_runs_totals_zero(pool: PgPool) {
        let admin = seed(&pool, "admin").await;
        let v = serde_json::to_value(
            budget_ai_usage(State(pool.clone()), who(admin))
                .await
                .expect("usage")
                .0,
        )
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({"currency": "USD", "models": [], "totalCost": "0"})
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn bad_prices_are_a_400_and_change_nothing(pool: PgPool) {
        let admin = seed(&pool, "admin").await;
        for (i, o) in [
            ("-1", "0"),
            ("0", "-0.1"),
            ("abc", "0"),
            ("", "0"),
            ("0", "1e3x"),
        ] {
            let err = set_budget_ai_prices(
                State(pool.clone()),
                who(admin),
                Json(BTreeMap::from([("m:x".to_string(), price(i, o))])),
            )
            .await
            .expect_err("rejected");
            assert_eq!(err.status(), StatusCode::BAD_REQUEST, "{i} / {o}");
        }
        assert!(
            gripsou_core::repo::settings::budget_ai_prices(&pool)
                .await
                .unwrap()
                .is_empty()
        );
    }
}
