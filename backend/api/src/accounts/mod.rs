//! Accounts and their net-worth series.

pub mod dto;

use axum::extract::{Path, Query, State};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{ApiError, Json};
use crate::routes::Routes;
use crate::wire::RangeParams;

pub async fn net_worth(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<dto::NetWorthResponse>, ApiError> {
    let (from, to) = p.window(&pool, user_id).await?;
    let rows = gripsou_core::repo::valuation::net_worth_series(&pool, user_id, from, to).await?;
    Ok(Json(dto::NetWorthResponse::from_rows(&rows)))
}

pub async fn accounts(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::Account>>, ApiError> {
    let rows = gripsou_core::repo::valuation::accounts(&pool, user_id).await?;
    let providers = jobs.providers();
    Ok(Json(
        rows.into_iter()
            .map(|r| dto::Account::from_row(r, providers.logos()))
            .collect(),
    ))
}

pub async fn account_series(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<dto::AccountSeriesResponse>, ApiError> {
    let (from, to) = p.window(&pool, user_id).await?;
    let rows = gripsou_core::repo::valuation::account_series(&pool, user_id, from, to).await?;
    Ok(Json(dto::AccountSeriesResponse::from_rows(rows)))
}

pub async fn account_types(State(pool): State<PgPool>) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(gripsou_core::repo::account::type_keys(&pool).await?))
}

pub async fn update_account(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::UpdateAccountReq>,
) -> Result<Json<dto::UpdatedAccount>, ApiError> {
    let updated = gripsou_core::repo::account::update_account(
        &pool,
        user_id,
        id,
        &body.name,
        &body.type_key,
        &body.color,
    )
    .await?
    .ok_or(ApiError::NotFound("account not found"))?;
    Ok(Json(dto::UpdatedAccount::from_row(updated)))
}

pub(crate) fn routes() -> Routes {
    Routes::default()
        .get("/dashboard/net-worth", net_worth)
        .get("/accounts", accounts)
        .get("/accounts/series", account_series)
        .patch("/accounts/{id}", update_account)
        .get("/account-types", account_types)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;
    use axum::http::StatusCode;
    use sqlx::PgPool;

    /// The frontend labels every account type the migrations seed, and no
    /// other (the review mock serves its keys as /account-types).
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn every_account_type_has_a_label(pool: PgPool) {
        let en: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../frontend/src/i18n/en.json"
        )))
        .unwrap();
        let mut labelled: Vec<String> = en["accountTypes"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        labelled.sort();
        let Json(seeded) = account_types(State(pool)).await.unwrap();
        assert_eq!(seeded, labelled);
    }

    /// Renaming another user's account by id must 404 and leave it untouched.
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn update_account_refuses_another_users_account(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        let bob = seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let err = update_account(
            State(pool.clone()),
            auth(bob.user),
            Path(alice.account),
            Json(dto::UpdateAccountReq {
                name: "Hijacked".into(),
                type_key: "pea".into(),
                color: "#000000".into(),
            }),
        )
        .await
        .err()
        .expect("cross-user update must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        let name: String = sqlx::query_scalar("select name from account where id = $1")
            .bind(alice.account)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "PEA");
    }

    /// The owner's update persists and echoes the new type.
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn update_account_persists_for_owner(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;

        let updated = update_account(
            State(pool.clone()),
            auth(alice.user),
            Path(alice.account),
            Json(dto::UpdateAccountReq {
                name: "Renamed".into(),
                type_key: "pea".into(),
                color: "#123456".into(),
            }),
        )
        .await
        .expect("owner may update")
        .0;
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.type_key, "pea");

        let (name, color): (String, Option<String>) =
            sqlx::query_as("select name, color from account where id = $1")
                .bind(alice.account)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(name, "Renamed");
        assert_eq!(color.as_deref(), Some("#123456"));
    }

    /// An account type that does not exist is refused (404) and writes nothing,
    /// so an account can never point at a type the UI cannot label.
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn update_account_rejects_unknown_type(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;

        let err = update_account(
            State(pool.clone()),
            auth(alice.user),
            Path(alice.account),
            Json(dto::UpdateAccountReq {
                name: "Renamed".into(),
                type_key: "no-such-type".into(),
                color: "#123456".into(),
            }),
        )
        .await
        .err()
        .expect("unknown type must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        let (name, type_key): (String, String) =
            sqlx::query_as("select name, type_key from account where id = $1")
                .bind(alice.account)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((name.as_str(), type_key.as_str()), ("PEA", "pea"));
    }

    /// The accounts list shows only the caller's accounts.
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn accounts_lists_only_own(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let list = accounts(State(pool.clone()), State(deps()), auth(alice.user))
            .await
            .expect("list ok")
            .0;
        let ids: Vec<String> = list.into_iter().map(|a| a.id).collect();
        assert_eq!(ids, vec![alice.account.to_string()]);
    }
}
