//! Provider connections: connecting one, syncing, managing and removing it,
//! and the provider webhook.

pub mod dto;

use crate::routes::Routes;
use axum::extract::{DefaultBodyLimit, OriginalUri, Path, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use gripsou_jobs::ConnectError;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{ApiError, Json};

pub async fn connections(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::ProviderGroup>>, ApiError> {
    let conns = gripsou_core::repo::connection::list_connections(&pool, user_id).await?;
    let accounts = gripsou_core::repo::connection::list_connection_accounts(&pool, user_id).await?;
    Ok(Json(dto::ProviderGroup::tree(
        conns,
        accounts,
        &jobs.providers(),
    )))
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
) -> Result<(StatusCode, Json<dto::SyncAllResp>), ApiError> {
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
    Ok((StatusCode::ACCEPTED, Json(dto::SyncAllResp { started })))
}

pub async fn enabled_providers(
    State(pool): State<PgPool>,
    _auth: AuthUser,
) -> Result<Json<Vec<dto::EnabledProvider>>, ApiError> {
    Ok(Json(
        gripsou_jobs::enabled_providers(&pool)
            .await?
            .into_iter()
            .map(dto::EnabledProvider::new)
            .collect(),
    ))
}

pub async fn manage_connection(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<
    (
        [(header::HeaderName, &'static str); 1],
        Json<dto::ManageResp>,
    ),
    ApiError,
> {
    let init = match gripsou_jobs::manage_connection(&pool, &jobs, user_id, id).await {
        Ok(init) => init,
        Err(ConnectError::NotFound) => return Err(ApiError::NotFound("connection not found")),
        Err(ConnectError::NoAdapter) => {
            return Err(ApiError::bad_request("connection management unavailable"));
        }
        Err(ConnectError::Db(e)) => return Err(e.into()),
        Err(e) => {
            // The temporary access URL and provider response must never enter
            // logs: the error names the failed call only.
            tracing::warn!(
                connection_id = %id,
                error = %gripsou_core::logs::error_chain(&e),
                "connection management failed"
            );
            return Err(ApiError::BadGateway(
                "Unable to open connection management. Please try again.".into(),
            ));
        }
    };
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(dto::ManageResp {
            redirect_url: init.redirect_url,
        }),
    ))
}

pub async fn init_connection(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::InitConnectionReq>,
) -> Result<(StatusCode, Json<dto::InitConnectionResp>), ApiError> {
    let provider = gripsou_jobs::enabled_provider(&pool, &body.provider_key)
        .await?
        .ok_or_else(|| {
            ApiError::BadRequest(format!("provider '{}' is not enabled", body.provider_key))
        })?;
    let (connection_id, init) = gripsou_jobs::init_connection(pool, &jobs, user_id, provider)
        .await
        .map_err(|e| ApiError::internal(gripsou_core::logs::error_chain(&e)))?;
    Ok((
        StatusCode::CREATED,
        Json(dto::InitConnectionResp {
            connection_id: connection_id.to_string(),
            redirect_url: init.redirect_url,
        }),
    ))
}

pub async fn complete_connection(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::CompleteConnectionReq>,
) -> Result<StatusCode, ApiError> {
    let id = body.connection_id;
    match gripsou_jobs::complete_connection(pool, &jobs, user_id, id, &body.params).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(ConnectError::NotFound) => Err(ApiError::NotFound("connection not found")),
        // The user cancelled at the bank, or the provider refused: its own
        // words go to the log only.
        Err(ConnectError::Provider(e)) => {
            tracing::warn!(connection_id = %id, step = "complete", error = %gripsou_core::logs::error_chain(&e), "connect failed");
            Err(ApiError::bad_request(
                "the provider did not complete the connection",
            ))
        }
        Err(e) => Err(ApiError::internal(gripsou_core::logs::error_chain(&e))),
    }
}

pub async fn webhook(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    Path(provider): Path<String>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> StatusCode {
    use gripsou_jobs::WebhookOutcome;
    let headers = headers
        .iter()
        .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
        .collect();
    match gripsou_jobs::handle_webhook(pool, &jobs, &provider, uri.path(), headers, body.to_vec())
        .await
    {
        WebhookOutcome::Accepted => StatusCode::OK,
        WebhookOutcome::Unauthorized => StatusCode::UNAUTHORIZED,
        WebhookOutcome::NotFound => StatusCode::NOT_FOUND,
        WebhookOutcome::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
    }
}

pub async fn delete_connection(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    if gripsou_core::repo::connection::delete_connection(&pool, user_id, id).await? {
        tracing::info!(connection_id = %id, "connection deleted");
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("connection not found"))
    }
}

pub(crate) fn routes() -> Routes {
    Routes::default()
        .get("/connections", connections)
        .post("/connections/init", init_connection)
        .post("/connections/complete", complete_connection)
        .delete("/connections/{id}", delete_connection)
        .post("/connections/{id}/sync", sync_connection)
        .post("/connections/{id}/manage", manage_connection)
        .post("/sync", sync_all)
        .get("/providers/enabled", enabled_providers)
        .layered(Method::POST, "/webhooks/{provider}", webhook, |route| {
            route.layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth;
    use crate::testkit::*;
    use gripsou_core::provider::{AccountProvider, CompleteConnect, ConnectInit, ProviderError};
    use sqlx::PgPool;

    /// An adapter that sends people to the Powens webview, with no keys, and
    /// counts the callbacks that reach it.
    #[derive(Default)]
    struct FakeBank(std::sync::atomic::AtomicUsize);

    #[async_trait::async_trait]
    impl AccountProvider for FakeBank {
        async fn connect(&self) -> Result<ConnectInit, ProviderError> {
            Ok(ConnectInit {
                redirect_url: Some("https://webview.powens.com/en/connect?x=1".into()),
            })
        }
        /// Keeps the callback's params as the connection's provider meta.
        async fn complete_connect(
            &self,
            params: &std::collections::HashMap<String, String>,
        ) -> Result<CompleteConnect, ProviderError> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(CompleteConnect {
                credentials: serde_json::json!({}),
                provider_meta: serde_json::json!(params),
            })
        }
        async fn sync(
            &self,
            _: &serde_json::Value,
        ) -> Result<gripsou_core::dto::SyncResult, ProviderError> {
            Err(ProviderError::NotImplemented)
        }
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn manage_connection_checks_ownership_before_provider_access(pool: PgPool) {
        let owner = seed_user(&pool, "owner@t.local").await;
        let other = seed_user(&pool, "other@t.local").await;
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

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn sync_connection_is_404_unknown_and_409_busy(pool: PgPool) {
        let user = seed_user(&pool, "a@t.local").await;
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
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn connections_returns_provider_tree(pool: PgPool) {
        let user = seed_user(&pool, "a@t.local").await;
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
        assert_eq!(
            groups[0].connections[0].accounts[0].value.as_deref(),
            Some("0")
        );
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn enabled_providers_returns_only_enabled(pool: PgPool) {
        let user = seed_user(&pool, "u@t.local").await;
        let listed = || async {
            enabled_providers(
                State(pool.clone()),
                auth::AuthUser {
                    user_id: user,
                    session_id: Uuid::new_v4(),
                },
            )
            .await
            .expect("ok")
            .0
            .into_iter()
            .map(|p| p.key)
            .collect::<Vec<_>>()
        };

        assert!(listed().await.contains(&"powens".to_string()));
        gripsou_core::repo::settings::set_provider_enabled(&pool, "powens", false)
            .await
            .unwrap();
        assert!(!listed().await.contains(&"powens".to_string()));
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn init_connection_rejects_unknown_provider(pool: PgPool) {
        let user = seed_user(&pool, "u@t.local").await;
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

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn init_connection_returns_redirect_url(pool: PgPool) {
        let user = seed_user(&pool, "u@t.local").await;
        let deps = crate::testkit::deps();
        deps.set_accounts(
            [(
                "powens".to_string(),
                std::sync::Arc::new(FakeBank::default()) as std::sync::Arc<dyn AccountProvider>,
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

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn delete_connection_guards_ownership(pool: PgPool) {
        let owner = seed_user(&pool, "owner@t.local").await;
        let other = seed_user(&pool, "other@t.local").await;

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

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn complete_connection_unknown_id_is_not_found(pool: PgPool) {
        let user = seed_user(&pool, "u@t.local").await;
        let err = complete_connection(
            State(pool.clone()),
            State(crate::testkit::deps()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
            Json(dto::CompleteConnectionReq {
                connection_id: Uuid::new_v4(),
                params: std::collections::HashMap::new(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err, ApiError::NotFound("connection not found"));
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_failed_complete_deletes_the_pending_connection_only(pool: PgPool) {
        use gripsou_core::repo::connection;
        let user = seed_user(&pool, "u@t.local").await;
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
                    connection_id: id,
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

    /// The provider's code is single-use: a replayed callback, or one naming
    /// another user's connection, is refused before the provider sees it.
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_replayed_or_foreign_callback_never_reaches_the_provider(pool: PgPool) {
        use gripsou_core::repo::connection;
        let user = seed_user(&pool, "u@t.local").await;
        let other = seed_user(&pool, "other@t.local").await;
        let bank = std::sync::Arc::new(FakeBank::default());
        let deps = crate::testkit::deps();
        deps.set_accounts(
            [(
                "powens".to_string(),
                bank.clone() as std::sync::Arc<dyn AccountProvider>,
            )]
            .into(),
        );
        let active = connection::insert_pending(&pool, user, "powens", "Bank")
            .await
            .unwrap();
        sqlx::query("update connection set status = 'ok' where id = $1")
            .bind(active)
            .execute(&pool)
            .await
            .unwrap();
        let foreign = connection::insert_pending(&pool, other, "powens", "Bank")
            .await
            .unwrap();

        for id in [active, foreign] {
            let err = complete_connection(
                State(pool.clone()),
                State(deps.clone()),
                auth::AuthUser {
                    user_id: user,
                    session_id: Uuid::new_v4(),
                },
                Json(dto::CompleteConnectionReq {
                    connection_id: id,
                    params: [("code".to_string(), "c".to_string())].into(),
                }),
            )
            .await
            .unwrap_err();
            assert_eq!(err, ApiError::NotFound("connection not found"));
        }
        assert_eq!(bank.0.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn complete_connection_hands_the_provider_the_params_unchanged(pool: PgPool) {
        let user = seed_user(&pool, "u@t.local").await;
        let deps = crate::testkit::deps();
        deps.set_accounts(
            [(
                "powens".to_string(),
                std::sync::Arc::new(FakeBank::default()) as std::sync::Arc<dyn AccountProvider>,
            )]
            .into(),
        );
        let id = gripsou_core::repo::connection::insert_pending(&pool, user, "powens", "Bank")
            .await
            .unwrap();
        let params: std::collections::HashMap<String, String> = [
            ("code".to_string(), "a&b=c".to_string()),
            ("connection_id".to_string(), "7".to_string()),
        ]
        .into();
        complete_connection(
            State(pool.clone()),
            State(deps),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
            Json(dto::CompleteConnectionReq {
                connection_id: id,
                params: params.clone(),
            }),
        )
        .await
        .unwrap();

        let meta: serde_json::Value =
            sqlx::query_scalar("select provider_meta from connection where id = $1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(meta, serde_json::json!(params));
    }
}
