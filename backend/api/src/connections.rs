//! Provider connections: connecting one, syncing, managing and removing it,
//! and the provider webhook.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::dto;
use crate::error::ApiError;

pub async fn connections(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::ProviderGroup>>, ApiError> {
    let conns = gripsou_core::repo::connection::list_connections(&pool, user_id).await?;
    let accounts = gripsou_core::repo::connection::list_connection_accounts(&pool, user_id).await?;
    Ok(Json(dto::ProviderGroup::tree(conns, accounts, &jobs)))
}

pub async fn sync_connection(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<dto::ConnectionState>), ApiError> {
    use gripsou_core::repo::connection::BeginSync;
    match gripsou_jobs::request_sync(
        pool.clone(),
        &jobs,
        user_id,
        id,
        gripsou_jobs::Trigger::Manual,
    )
    .await?
    {
        BeginSync::Started(state) => {
            tracing::info!(connection_id = %id, "sync requested");
            Ok((
                StatusCode::ACCEPTED,
                Json(dto::ConnectionState::from_row(state)),
            ))
        }
        BeginSync::AlreadySyncing => Err(ApiError::Conflict("connection is already syncing")),
        BeginSync::NotFound => Err(ApiError::NotFound("connection not found")),
    }
}

pub async fn sync_all(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    use gripsou_core::repo::connection::BeginSync;
    let ids = gripsou_core::repo::connection::ids_for_user(&pool, user_id).await?;
    let mut started = 0u32;
    for id in ids {
        if let BeginSync::Started(_) = gripsou_jobs::request_sync(
            pool.clone(),
            &jobs,
            user_id,
            id,
            gripsou_jobs::Trigger::Manual,
        )
        .await?
        {
            started += 1;
        }
    }
    tracing::info!(started, "sync requested");
    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "started": started })),
    ))
}

pub async fn enabled_providers(
    State(pool): State<PgPool>,
    _auth: AuthUser,
) -> Result<Json<Vec<dto::EnabledProvider>>, ApiError> {
    let enabled = gripsou_core::repo::provider::enabled(&pool).await?;
    Ok(Json(
        gripsou_jobs::ACCOUNT_PROVIDERS
            .iter()
            .filter(|k| enabled.iter().any(|e| e == k.key))
            .map(dto::EnabledProvider::new)
            .collect(),
    ))
}

pub async fn manage_connection(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<(HeaderMap, Json<serde_json::Value>), ApiError> {
    let conn = gripsou_core::repo::connection::connection_for_sync(&pool, user_id, id)
        .await?
        .ok_or(ApiError::NotFound("connection not found"))?;
    if !jobs.supports_manage(&conn.provider_key) {
        return Err(ApiError::bad_request("connection management unavailable"));
    }
    let init = gripsou_jobs::manage_connection(&jobs, &conn)
        .await
        .map_err(|_| {
            // The temporary access URL and provider response must never enter logs.
            tracing::warn!(connection_id = %id, "connection management failed");
            ApiError::BadGateway("Unable to open connection management. Please try again.".into())
        })?;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        "no-store".parse().unwrap(),
    );
    Ok((
        headers,
        Json(serde_json::json!({"redirectUrl": init.redirect_url})),
    ))
}

pub async fn init_connection(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::InitConnectionReq>,
) -> Result<(StatusCode, Json<dto::InitConnectionResp>), ApiError> {
    // Validate provider is known and enabled (also gives the row's name).
    let enabled = gripsou_core::repo::provider::enabled(&pool).await?;
    let provider = gripsou_jobs::account_provider(&body.provider_key)
        .filter(|k| enabled.iter().any(|e| e == k.key))
        .ok_or_else(|| {
            ApiError::BadRequest(format!("provider '{}' is not enabled", body.provider_key))
        })?;

    match gripsou_jobs::init_connection(
        pool,
        &jobs,
        user_id,
        &body.provider_key,
        provider.display_name,
    )
    .await
    {
        Ok((connection_id, init)) => Ok((
            StatusCode::CREATED,
            Json(dto::InitConnectionResp {
                connection_id: connection_id.to_string(),
                redirect_url: init.redirect_url,
            }),
        )),
        Err(e) => {
            tracing::warn!(provider = %body.provider_key, step = "init", error = %gripsou_core::logs::error_chain(&e), "connect failed");
            Err(ApiError::Internal)
        }
    }
}

pub async fn complete_connection(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::CompleteConnectionReq>,
) -> Result<StatusCode, ApiError> {
    let connection_id = body
        .connection_id
        .parse::<Uuid>()
        .map_err(|_| ApiError::bad_request("invalid connection_id"))?;

    use gripsou_jobs::CompleteError;
    match gripsou_jobs::complete_connection(pool, &jobs, user_id, connection_id, &body.params).await
    {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(CompleteError::NotFound) => Err(ApiError::NotFound("connection not found")),
        Err(CompleteError::Provider(e)) => {
            tracing::warn!(connection_id = %connection_id, step = "complete", error = %gripsou_core::logs::error_chain(&e), "connect failed");
            Err(ApiError::BadRequest(e.to_string()))
        }
        Err(CompleteError::Internal(e)) => Err(ApiError::internal(e)),
    }
}

pub async fn webhook(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    Path(provider): Path<String>,
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> StatusCode {
    use gripsou_jobs::WebhookOutcome;
    let hmap: std::collections::HashMap<String, String> = headers
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|s| (k.as_str().to_lowercase(), s.to_string()))
        })
        .collect();
    match gripsou_jobs::handle_webhook(pool, &jobs, &provider, uri.path(), hmap, body.to_vec())
        .await
    {
        WebhookOutcome::Accepted => StatusCode::OK,
        WebhookOutcome::Unauthorized => StatusCode::UNAUTHORIZED,
        WebhookOutcome::NotFound => StatusCode::NOT_FOUND,
    }
}

pub async fn delete_connection(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let deleted = gripsou_core::repo::connection::delete_connection(&pool, user_id, id).await?;
    if deleted {
        tracing::info!(user_id = %user_id, connection_id = %id, "connection deleted");
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("connection not found"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth;
    use crate::testkit::seed_user_with_password;
    use gripsou_core::provider::{AccountProvider, CompleteConnect, ConnectInit, ProviderError};
    use sqlx::PgPool;

    /// An adapter that sends people to the Powens webview, with no keys.
    struct FakeBank;

    #[async_trait::async_trait]
    impl AccountProvider for FakeBank {
        fn key(&self) -> &str {
            "powens"
        }
        async fn connect(&self) -> Result<ConnectInit, ProviderError> {
            Ok(ConnectInit {
                redirect_url: Some("https://webview.powens.com/en/connect?x=1".into()),
            })
        }
        async fn complete_connect(&self, _: &str) -> Result<CompleteConnect, ProviderError> {
            Err(ProviderError::NotImplemented)
        }
        async fn sync(
            &self,
            _: &serde_json::Value,
        ) -> Result<gripsou_core::dto::SyncResult, ProviderError> {
            Err(ProviderError::NotImplemented)
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn manage_connection_checks_ownership_before_provider_access(pool: PgPool) {
        let owner = seed_user_with_password(&pool, "owner@t.local", "pw", "user").await;
        let other = seed_user_with_password(&pool, "other@t.local", "pw", "user").await;
        let id = gripsou_core::repo::connection::insert_pending(&pool, owner, "powens", "Bank")
            .await
            .unwrap();
        let principal = || auth::AuthUser {
            user_id: other,
            session_id: Uuid::new_v4(),
        };
        for target in [id, Uuid::new_v4()] {
            let error = manage_connection(
                State(pool.clone()),
                State(crate::testkit::deps()),
                principal(),
                Path(target),
            )
            .await
            .unwrap_err();
            assert_eq!(error.status(), StatusCode::NOT_FOUND);
        }
        let stored = gripsou_core::repo::connection::connection_for_sync(&pool, owner, id)
            .await
            .unwrap();
        assert!(
            stored.is_some(),
            "Manage must not delete the existing connection"
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn sync_connection_guards_and_orchestrator_errors(pool: PgPool) {
        let user = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let conn = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1,$2,'powens','c')",
        )
        .bind(conn)
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();

        let principal = || auth::AuthUser {
            user_id: user,
            session_id: Uuid::new_v4(),
        };

        // Unknown connection → 404.
        let nf = sync_connection(
            State(pool.clone()),
            State(crate::testkit::deps()),
            principal(),
            Path(Uuid::new_v4()),
        )
        .await
        .unwrap_err();
        assert_eq!(nf.status(), StatusCode::NOT_FOUND);

        // Force a 'syncing' claim, then a trigger → 409.
        sqlx::query("update connection set status='syncing' where id=$1")
            .bind(conn)
            .execute(&pool)
            .await
            .unwrap();
        let busy = sync_connection(
            State(pool.clone()),
            State(crate::testkit::deps()),
            principal(),
            Path(conn),
        )
        .await
        .unwrap_err();
        assert_eq!(busy.status(), StatusCode::CONFLICT);

        // Reset, then run the orchestrator directly (deterministic — no spawn):
        // the stub adapter returns NotImplemented, so status becomes 'error'.
        sqlx::query("update connection set status='ok' where id=$1")
            .bind(conn)
            .execute(&pool)
            .await
            .unwrap();
        gripsou_jobs::sync_connection(pool.clone(), crate::testkit::deps(), conn).await;
        let (status, err): (String, Option<String>) =
            sqlx::query_as("select status, last_error from connection where id=$1")
                .bind(conn)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "error");
        assert!(err.is_some(), "expected a last_error message");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn connections_returns_provider_tree(pool: PgPool) {
        let user = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let conn = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1,$2,'powens','My bank')",
        )
        .bind(conn)
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into account (connection_id, name, currency, type_key, color) \
             values ($1,'Checking','EUR','checking','#4dd0b1')",
        )
        .bind(conn)
        .execute(&pool)
        .await
        .unwrap();

        let groups = connections(
            State(pool.clone()),
            State(crate::testkit::deps()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
        )
        .await
        .expect("connections ok")
        .0;

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].provider_name, "Powens");
        assert_eq!(groups[0].connections.len(), 1);
        assert_eq!(groups[0].connections[0].display_name, "My bank");
        // Account with no snapshots still appears, valued "0".
        assert_eq!(groups[0].connections[0].accounts.len(), 1);
        assert_eq!(groups[0].connections[0].accounts[0].value, "0");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn enabled_providers_returns_only_enabled(pool: PgPool) {
        // Seed: powens is enabled via migration 0002.
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let rows = enabled_providers(
            State(pool.clone()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
        )
        .await
        .expect("ok")
        .0;

        // Only account providers in the enabled_providers list.
        assert!(
            rows.iter().all(|p| p.key != "yahoo"),
            "price providers must be excluded"
        );
        // Powens is in enabled_providers per seed — it should appear.
        assert!(
            rows.iter().any(|p| p.key == "powens"),
            "powens should be in enabled list"
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn init_connection_rejects_unknown_provider(pool: PgPool) {
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let err = init_connection(
            State(pool.clone()),
            State(crate::testkit::deps()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
            Json(dto::InitConnectionReq {
                provider_key: "nope".to_string(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn init_connection_returns_redirect_url(pool: PgPool) {
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let deps = crate::testkit::deps();
        deps.set_accounts(
            [(
                "powens".to_string(),
                std::sync::Arc::new(FakeBank) as std::sync::Arc<dyn AccountProvider>,
            )]
            .into(),
        );
        let resp = init_connection(
            State(pool.clone()),
            State(deps),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
            Json(dto::InitConnectionReq {
                provider_key: "powens".to_string(),
            }),
        )
        .await
        .unwrap();

        assert_eq!(resp.0, StatusCode::CREATED);
        assert!(
            resp.1
                .redirect_url
                .as_ref()
                .unwrap()
                .starts_with("https://webview.powens.com/en/connect")
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_connection_guards_ownership(pool: PgPool) {
        let owner = seed_user_with_password(&pool, "owner@t.local", "pw", "user").await;
        let other = seed_user_with_password(&pool, "other@t.local", "pw", "user").await;

        let conn_id = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1, $2, 'powens', 'c')",
        )
        .bind(conn_id)
        .bind(owner)
        .execute(&pool)
        .await
        .unwrap();

        // Wrong user → 404.
        let err = delete_connection(
            State(pool.clone()),
            auth::AuthUser {
                user_id: other,
                session_id: Uuid::new_v4(),
            },
            axum::extract::Path(conn_id),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        // Correct user → 204.
        let ok = delete_connection(
            State(pool.clone()),
            auth::AuthUser {
                user_id: owner,
                session_id: Uuid::new_v4(),
            },
            axum::extract::Path(conn_id),
        )
        .await
        .expect("delete ok");
        assert_eq!(ok, StatusCode::NO_CONTENT);

        // Connection is gone.
        let count: i64 = sqlx::query_scalar("select count(*) from connection where id=$1")
            .bind(conn_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn complete_connection_unknown_id_is_not_found(pool: PgPool) {
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let err = complete_connection(
            State(pool.clone()),
            State(crate::testkit::deps()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
            Json(dto::CompleteConnectionReq {
                connection_id: Uuid::new_v4().to_string(),
                params: std::collections::HashMap::new(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err, ApiError::NotFound("connection not found"));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_failed_complete_deletes_the_pending_connection_only(pool: PgPool) {
        use gripsou_core::repo::connection;
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let pending = connection::insert_pending(&pool, user, "powens", "Bank")
            .await
            .unwrap();
        let active = connection::insert_pending(&pool, user, "powens", "Bank")
            .await
            .unwrap();
        sqlx::query("update connection set status = 'ok' where id = $1")
            .bind(active)
            .execute(&pool)
            .await
            .unwrap();

        for id in [pending, active] {
            complete_connection(
                State(pool.clone()),
                State(crate::testkit::deps()),
                auth::AuthUser {
                    user_id: user,
                    session_id: Uuid::new_v4(),
                },
                Json(dto::CompleteConnectionReq {
                    connection_id: id.to_string(),
                    params: [("error".to_string(), "access_denied".to_string())].into(),
                }),
            )
            .await
            .unwrap_err();
        }

        let left: Vec<Uuid> = sqlx::query_scalar("select id from connection where user_id = $1")
            .bind(user)
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(left, vec![active]);
    }
}
