//! Admin-only settings: account providers, provider API keys, the budget AI and its prices,
//! users, invites and reset links.

pub mod dto;

use crate::error::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppState;
use crate::auth::{AdminUser, challenge, invite};
use crate::error::ApiError;
use crate::routes::Routes;
use axum::Router;
use gripsou_core::repo::invite_token::TokenKind;
use gripsou_core::repo::user::AdminGuarded;
use gripsou_providers::registry;

/// Every admin route. [`router`] puts them all behind the admin check, so
/// none can be added without it.
pub(crate) fn routes() -> Routes {
    Routes::default()
        .get("/users", users)
        .patch("/users/{id}", set_role)
        .delete("/users/{id}", delete_user)
        .post("/users/{id}/reset-link", create_reset_link)
        .post("/invites", create_invite)
        .get("/providers", providers)
        .patch("/providers/{key}", set_provider)
        .get("/settings/budget-ai", budget_ai_settings)
        .patch("/settings/budget-ai", set_budget_ai_settings)
        .get("/settings/budget-ai/usage", budget_ai_usage)
        .get("/settings/budget-ai/models/{provider}", budget_ai_models)
        .put("/settings/budget-ai/prices", set_budget_ai_prices)
        .get("/settings/api-keys", api_keys)
        .patch("/settings/api-keys/{provider}", set_api_key)
}

pub(crate) fn router(state: AppState) -> Router<AppState> {
    routes()
        .into_router()
        .route_layer(axum::middleware::from_fn_with_state(
            state,
            crate::auth::session::require_admin,
        ))
}

pub async fn providers(
    State(pool): State<PgPool>,
    _: AdminUser,
) -> Result<Json<Vec<dto::Provider>>, ApiError> {
    let enabled = gripsou_jobs::enabled_providers(&pool).await?;
    Ok(Json(
        registry::ACCOUNTS
            .iter()
            .map(|k| dto::Provider::new(k, enabled.iter().any(|e| e.about.key == k.about.key)))
            .collect(),
    ))
}

pub async fn api_keys(
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    _: AdminUser,
) -> Json<Vec<dto::ApiKeyProvider>> {
    let providers = jobs.providers();
    Json(
        registry::keyed()
            .map(|k| dto::ApiKeyProvider::new(k, providers.config()))
            .collect(),
    )
}

/// The longest value accepted: real keys are far shorter.
const MAX_KEY_CHARS: usize = 1000;

pub async fn set_api_key(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    _: AdminUser,
    Path(provider): Path<String>,
    Json(body): Json<dto::SetApiKeyReq>,
) -> Result<Json<dto::ApiKeyProvider>, ApiError> {
    let kind =
        registry::keyed_provider(&provider).ok_or(ApiError::NotFound("provider not found"))?;
    if !kind.fields.iter().any(|f| f.key == body.field) {
        return Err(ApiError::NotFound("field not found"));
    }
    let value = body
        .value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if value.is_some_and(|v| v.chars().count() > MAX_KEY_CHARS) {
        return Err(ApiError::bad_request("value too long"));
    }
    let config = gripsou_core::repo::provider_config::set_field(
        &pool,
        &jobs.key,
        &provider,
        &body.field,
        value,
    )
    .await?;
    let removed = config.get(&provider, &body.field).is_none();
    tracing::info!(
        provider = %provider,
        field = %body.field,
        action = if removed { "removed" } else { "set" },
        "provider setting changed"
    );
    let dto = dto::ApiKeyProvider::new(kind, &config);
    jobs.apply_config(config);
    Ok(Json(dto))
}

pub async fn budget_ai_settings(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    _: AdminUser,
) -> Result<Json<dto::BudgetAiSettingsDto>, ApiError> {
    let s = gripsou_core::repo::settings::budget_ai(&pool).await?;
    let defaults = registry::CATEGORIZERS
        .iter()
        .map(|k| (k.about.key, k.default_model))
        .collect();
    Ok(Json(dto::BudgetAiSettingsDto {
        provider: s.provider,
        model: s.model,
        available: jobs.providers().available_categorizers(),
        defaults,
    }))
}

pub async fn set_budget_ai_settings(
    State(pool): State<PgPool>,
    _: AdminUser,
    Json(body): Json<dto::SetBudgetAiSettingsReq>,
) -> Result<StatusCode, ApiError> {
    let provider = body
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty());
    if provider.is_some_and(|p| registry::categorizer_kind(p).is_none()) {
        return Err(ApiError::bad_request("unknown provider"));
    }
    let model = body
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty());
    gripsou_core::repo::settings::set_budget_ai(&pool, provider, model).await?;
    tracing::info!(
        provider = provider.unwrap_or(""),
        model = model.unwrap_or(""),
        "ai settings changed"
    );
    Ok(StatusCode::NO_CONTENT)
}

/// The models the provider offers, for the admin's model dropdown. Asked of
/// the provider on every call: the list is short and only read by an admin.
pub async fn budget_ai_models(
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    _: AdminUser,
    Path(provider): Path<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    if registry::categorizer_kind(&provider).is_none() {
        return Err(ApiError::NotFound("unknown provider"));
    }
    match jobs.providers().categorizer_models(&provider).await {
        Some(Ok(models)) => Ok(Json(models)),
        Some(Err(e)) => {
            tracing::warn!(provider = %provider, error = %gripsou_core::logs::error_chain(&e), "ai model list failed");
            Err(ApiError::BadGateway(
                "the provider did not list its models".into(),
            ))
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
    _: AdminUser,
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
    tracing::info!(models = prices.len() as u64, "ai prices changed");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn set_provider(
    State(pool): State<PgPool>,
    _: AdminUser,
    Path(key): Path<String>,
    Json(body): Json<dto::SetProviderReq>,
) -> Result<Json<dto::Provider>, ApiError> {
    let kind = registry::account_kind(&key).ok_or(ApiError::NotFound("provider not found"))?;
    gripsou_core::repo::settings::set_provider_enabled(&pool, &key, body.enabled).await?;
    tracing::info!(provider = %key, enabled = body.enabled, "provider enabled changed");
    Ok(Json(dto::Provider::new(kind, body.enabled)))
}

pub async fn users(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
) -> Result<Json<Vec<dto::User>>, ApiError> {
    // Listing every account (names/emails/roles) is admin-only.
    let rows = gripsou_core::repo::user::list(&pool).await?;
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
    let raw = invite::mint(&pool, TokenKind::Invite, None, user_id).await?;
    tracing::info!("invite created");
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
    Json(body): Json<crate::auth::dto::ReauthTokenReq>,
) -> Result<(StatusCode, Json<dto::InviteLinkResp>), ApiError> {
    if id == user_id {
        return Err(ApiError::bad_request(
            "cannot create a reset link for yourself",
        ));
    }
    let target = gripsou_core::repo::user::profile_by_id(&pool, id)
        .await?
        .ok_or(ApiError::NotFound("user not found"))?;
    challenge::spend_reauth(&pool, user_id, &body.reauth).await?;
    let raw = invite::mint(&pool, TokenKind::Reset, Some(&target.email), user_id).await?;
    tracing::info!(target_user_id = %id, "reset link created");
    Ok((
        StatusCode::CREATED,
        Json(dto::InviteLinkResp { token: raw }),
    ))
}

pub async fn set_role(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::SetRoleReq>,
) -> Result<StatusCode, ApiError> {
    // An admin demoting themselves would lose this page mid-sentence; another
    // admin can do it.
    if id == user_id {
        return Err(ApiError::Conflict("cannot change your own role"));
    }
    match gripsou_core::repo::user::set_role(&pool, id, body.role).await? {
        AdminGuarded::Done => {}
        AdminGuarded::NotFound => return Err(ApiError::NotFound("user not found")),
        AdminGuarded::LastAdmin => return Err(ApiError::Conflict("cannot demote the last admin")),
    }
    tracing::info!(target_user_id = %id, role = %body.role, "user role changed");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_user(
    State(pool): State<PgPool>,
    _: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::DeleteUserReq>,
) -> Result<StatusCode, ApiError> {
    let target = gripsou_core::repo::user::profile_by_id(&pool, id)
        .await?
        .ok_or(ApiError::NotFound("user not found"))?;
    if body.email.trim().to_lowercase() != target.email.to_lowercase() {
        return Err(ApiError::bad_request("email does not match user"));
    }
    match gripsou_core::repo::user::delete_user(&pool, id).await? {
        AdminGuarded::Done => {}
        AdminGuarded::NotFound => return Err(ApiError::NotFound("user not found")),
        AdminGuarded::LastAdmin => return Err(ApiError::Conflict("cannot delete the last admin")),
    }
    tracing::info!(target_user_id = %id, "user deleted");
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;
    use sqlx::PgPool;

    /// Every admin route refuses a member before the handler runs (no body
    /// is sent, so a handler would answer 4xx).
    #[sqlx::test(migrations = "../migrations")]
    async fn every_admin_route_refuses_a_member(pool: PgPool) {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;

        seed_user(&pool, "member@t.local").await;
        let token = login_token(&pool, "member@t.local", PASSWORD).await;
        let passkeys = crate::Passkeys::parse(Some("https://gripsou.test")).unwrap();
        let app = crate::router(pool, &std::env::temp_dir(), deps(), passkeys);
        let id = Uuid::new_v4().to_string();
        for (method, path) in routes().list() {
            let path = format!("/api{path}")
                .split('/')
                .map(|seg| {
                    if seg.starts_with('{') {
                        id.as_str()
                    } else {
                        seg
                    }
                })
                .collect::<Vec<_>>()
                .join("/");
            let status = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(&path)
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap()
                .status();
            assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}");
        }
    }

    #[test]
    fn api_key_dto_never_carries_a_secret() {
        let mut c = gripsou_core::provider_config::ProviderConfig::default();
        c.set("powens", "client_id", Some("id-1".into()));
        c.set("powens", "client_secret", Some("hunter2".into()));
        let dto = dto::ApiKeyProvider::new(registry::keyed_provider("powens").unwrap(), &c);
        let json = serde_json::to_string(&dto).unwrap();
        assert!(!json.contains("hunter2"), "{json}");
        assert!(json.contains(r#""value":"id-1""#), "{json}");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn an_api_key_is_trimmed_removed_by_a_blank_and_refused_when_unknown(pool: PgPool) {
        let admin = seed_admin(&pool, "a@t.local").await;
        let set = |provider: &str, field: &str, value: &str| {
            set_api_key(
                State(pool.clone()),
                State(deps()),
                AdminUser { user_id: admin },
                Path(provider.to_string()),
                Json(dto::SetApiKeyReq {
                    field: field.into(),
                    value: Some(value.into()),
                }),
            )
        };
        let stored = || async {
            gripsou_core::repo::provider_config::load(
                &pool,
                &gripsou_core::testkit::encryption_key(),
            )
            .await
            .unwrap()
            .config
            .get("jev", "api_key")
            .map(str::to_string)
        };
        set("jev", "api_key", "  k  ").await.unwrap();
        assert_eq!(stored().await.as_deref(), Some("k"));
        set("jev", "api_key", "   ").await.unwrap();
        assert_eq!(stored().await, None, "blank removes");
        for (p, f) in [("nope", "api_key"), ("jev", "nope")] {
            let err = set(p, f, "x").await.unwrap_err();
            assert_eq!(err.status(), StatusCode::NOT_FOUND, "{p}.{f}");
        }
        let err = set("jev", "api_key", &"x".repeat(1001)).await.unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn set_provider_toggles_enabled_idempotently(pool: PgPool) {
        let admin = seed_admin(&pool, "admin@t.local").await;
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
        let admin = seed_admin(&pool, "admin@t.local").await;
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
        let admin = seed_admin(&pool, "a@t.local").await;
        let who = principal_for(&pool, "a@t.local", PASSWORD).await;
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
        seed_admin(&pool, "a@t.local").await;
        let target = seed_user(&pool, "target@t.local").await;
        let who = principal_for(&pool, "a@t.local", PASSWORD).await;

        let reauth = reauth_token(&pool, &who, PASSWORD).await;
        let resp = create_reset_link(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(target),
            Json(crate::auth::dto::ReauthTokenReq { reauth }),
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
        let admin = seed_admin(&pool, "a@t.local").await;
        let target = seed_user(&pool, "target@t.local").await;
        let who = principal_for(&pool, "a@t.local", PASSWORD).await;
        let create = |id, reauth: &str| {
            create_reset_link(
                State(pool.clone()),
                AdminUser {
                    user_id: who.user_id,
                },
                Path(id),
                Json(crate::auth::dto::ReauthTokenReq {
                    reauth: reauth.into(),
                }),
            )
        };

        let err = create(target, "forged").await.unwrap_err();
        assert_eq!(err.status(), StatusCode::FORBIDDEN);
        let reauth = reauth_token(&pool, &who, PASSWORD).await;
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
        seed_admin(&pool, "a@t.local").await;
        let target = seed_user(&pool, "target@t.local").await;
        let who = principal_for(&pool, "a@t.local", PASSWORD).await;

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
    async fn set_role_promotes_and_demotes_another_user(pool: PgPool) {
        seed_admin(&pool, "a@t.local").await;
        let target = seed_user(&pool, "b@t.local").await;
        let who = principal_for(&pool, "a@t.local", PASSWORD).await;
        let set = |role| {
            set_role(
                State(pool.clone()),
                AdminUser {
                    user_id: who.user_id,
                },
                Path(target),
                Json(dto::SetRoleReq { role }),
            )
        };
        let role_of = || async {
            gripsou_core::repo::user::profile_by_id(&pool, target)
                .await
                .unwrap()
                .unwrap()
                .role
        };

        assert_eq!(set(Role::Admin).await.unwrap(), StatusCode::NO_CONTENT);
        assert_eq!(role_of().await, Role::Admin);
        assert_eq!(set(Role::User).await.unwrap(), StatusCode::NO_CONTENT);
        assert_eq!(role_of().await, Role::User);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn set_role_refuses_your_own(pool: PgPool) {
        seed_admin(&pool, "a@t.local").await;
        seed_admin(&pool, "b@t.local").await;
        let who = principal_for(&pool, "a@t.local", PASSWORD).await;
        let err = set_role(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(who.user_id),
            Json(dto::SetRoleReq { role: Role::User }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::CONFLICT);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_user_refuses_last_admin(pool: PgPool) {
        let admin = seed_admin(&pool, "boss@t.local").await;
        let who = principal_for(&pool, "boss@t.local", PASSWORD).await;

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
        seed_admin(&pool, "a@t.local").await;
        let target = seed_user(&pool, "target@t.local").await;
        let who = principal_for(&pool, "a@t.local", PASSWORD).await;

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
        let admin = seed_admin(&pool, "a@t.local").await;
        let err = budget_ai_models(
            State(deps()),
            AdminUser { user_id: admin },
            Path("nope".into()),
        )
        .await
        .expect_err("not found");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
    }

    /// An admin's budget AI choice persists (trimmed) and reads back as written.
    #[sqlx::test(migrations = "../migrations")]
    async fn set_budget_ai_settings_persists(pool: PgPool) {
        let admin = seed_admin(&pool, "a@t.local").await;
        let key = registry::CATEGORIZERS[0].about.key;

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

        let read = budget_ai_settings(
            State(pool.clone()),
            State(deps()),
            AdminUser { user_id: admin },
        )
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
        let admin = seed_admin(&pool, "a@t.local").await;
        let key = registry::CATEGORIZERS[0].about.key;
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
        let admin = seed_admin(&pool, "a@t.local").await;
        let key = registry::CATEGORIZERS[0].about.key;
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

    use std::collections::BTreeMap;

    fn price(i: &str, o: &str) -> dto::BudgetAiPriceReq {
        dto::BudgetAiPriceReq {
            input: i.into(),
            output: o.into(),
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn prices_then_usage(pool: PgPool) {
        let admin = seed_admin(&pool, "a@t.local").await;
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
            AdminUser { user_id: admin },
            Json(BTreeMap::from([
                ("jev:jev-latest".to_string(), price("0.042", "0")),
                ("unused:m".to_string(), price("1", "1")),
            ])),
        )
        .await
        .expect("prices saved");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let v = serde_json::to_value(
            budget_ai_usage(State(pool.clone()), AdminUser { user_id: admin })
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
        let admin = seed_admin(&pool, "a@t.local").await;
        let v = serde_json::to_value(
            budget_ai_usage(State(pool.clone()), AdminUser { user_id: admin })
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
        let admin = seed_admin(&pool, "a@t.local").await;
        for (i, o) in [
            ("-1", "0"),
            ("0", "-0.1"),
            ("abc", "0"),
            ("", "0"),
            ("0", "1e3x"),
        ] {
            let err = set_budget_ai_prices(
                State(pool.clone()),
                AdminUser { user_id: admin },
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
