//! Accounts, their net-worth series and the transactions list.

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{Datelike, Duration, NaiveDate};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::dto;
use crate::error::ApiError;

/// Inclusive calendar-day windows, anchored to the caller's saved timezone.
pub(crate) fn range_window(range: &str, today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let from = match range {
        "24h" => today - Duration::days(1),
        "7d" => today - Duration::days(7),
        "1mo" => today - Duration::days(30),
        "6mo" => today - Duration::days(182),
        "1y" => today - Duration::days(365),
        "ytd" => NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap(),
        _ => today - Duration::days(4000),
    };
    (from, today)
}

#[derive(Deserialize)]
pub struct RangeParams {
    #[serde(default = "default_range")]
    pub(crate) range: String,
}

fn default_range() -> String {
    "6mo".to_string()
}

pub async fn net_worth(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<dto::NetWorthResponse>, ApiError> {
    let today = gripsou_core::repo::prefs::today(&pool, user_id).await?;
    let (from, to) = range_window(&p.range, today);
    let rows = gripsou_core::repo::query::net_worth_series(&pool, user_id, from, to).await?;
    Ok(Json(dto::NetWorthResponse::from_rows(&rows)))
}

pub async fn accounts(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::Account>>, ApiError> {
    let rows = gripsou_core::repo::query::accounts(&pool, user_id).await?;
    Ok(Json(rows.into_iter().map(dto::Account::from_row).collect()))
}

pub async fn account_series(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<dto::AccountSeriesResponse>, ApiError> {
    let today = gripsou_core::repo::prefs::today(&pool, user_id).await?;
    let (from, to) = range_window(&p.range, today);
    let rows = gripsou_core::repo::query::account_series(&pool, user_id, from, to).await?;
    Ok(Json(dto::AccountSeriesResponse::from_rows(rows)))
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransactionParams {
    pub search: Option<String>,
    pub account_id: Option<Uuid>,
    /// `all` | `in` | `out` | `lots` — the TYPE control on the filter panel.
    pub bucket: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    /// Comma-separated uuids. Several categories mean *either*.
    pub category_ids: Option<String>,
    /// Comma-separated uuids. Several tags mean *all*.
    pub tag_ids: Option<String>,
    pub uncategorized: Option<bool>,
    pub needs_review: Option<bool>,
    /// Absent means hide internal transfers — the list's default.
    pub include_transfers: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// A filter the server cannot fully honour must never be silently narrowed to
/// a wider one, so an unparseable `categoryIds`/`tagIds` component or an
/// unrecognised `bucket` is a 400 here, not a dropped id or a fall-through to
/// `all` — see `budget::parse_ids`/`parse_bucket`.
pub fn filters_from_params(
    p: TransactionParams,
    review_threshold: rust_decimal::Decimal,
) -> Result<gripsou_core::repo::query::TransactionFilters, ApiError> {
    use gripsou_core::repo::query::TransactionFilters;
    Ok(TransactionFilters {
        search: p.search.filter(|s| !s.trim().is_empty()),
        account_id: p.account_id,
        bucket: crate::budget::parse_bucket(p.bucket.as_deref())?,
        from: p.from,
        to: p.to,
        category_ids: crate::budget::parse_ids(p.category_ids.as_deref())?,
        tag_ids: crate::budget::parse_ids(p.tag_ids.as_deref())?,
        uncategorized: p.uncategorized.unwrap_or(false),
        needs_review: p.needs_review.unwrap_or(false),
        // Hidden unless asked for: unlike every other filter here, the
        // default is *not* "everything".
        include_transfers: p.include_transfers.unwrap_or(false),
        review_threshold,
        // Capped so a crafted `limit` cannot ask for the whole ledger at once.
        limit: p.limit.unwrap_or(200).clamp(1, 500),
        offset: p.offset.unwrap_or(0).max(0),
    })
}

pub async fn transactions(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<TransactionParams>,
) -> Result<Json<Vec<dto::Transaction>>, ApiError> {
    let threshold = gripsou_core::repo::prefs::review_threshold(&pool, user_id).await?;
    let filters = filters_from_params(p, threshold)?;
    let rows = gripsou_core::repo::query::transactions(&pool, user_id, &filters).await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut tags = gripsou_core::repo::query::tags_for_transactions(&pool, user_id, &ids).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                let row_tags = tags.remove(&r.id).unwrap_or_default();
                dto::Transaction::from_row(r, row_tags)
            })
            .collect(),
    ))
}

pub async fn account_types(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<dto::AccountType>>, ApiError> {
    let rows = gripsou_core::repo::query::account_types(&pool).await?;
    Ok(Json(
        rows.into_iter().map(dto::AccountType::from_row).collect(),
    ))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;
    use axum::http::StatusCode;
    use sqlx::PgPool;

    #[test]
    fn calendar_range_uses_the_supplied_local_day() {
        let today = NaiveDate::from_ymd_opt(2027, 1, 1).unwrap();
        assert_eq!(range_window("ytd", today), (today, today));
        assert_eq!(
            range_window("7d", today),
            (NaiveDate::from_ymd_opt(2026, 12, 25).unwrap(), today)
        );
    }

    fn no_txn_filters() -> TransactionParams {
        TransactionParams {
            search: None,
            account_id: None,
            bucket: None,
            from: None,
            to: None,
            category_ids: None,
            tag_ids: None,
            uncategorized: None,
            needs_review: None,
            include_transfers: None,
            limit: None,
            offset: None,
        }
    }

    /// Renaming another user's account by id must 404 and leave it untouched.
    #[sqlx::test(migrations = "../migrations")]
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

    /// The owner's update persists and echoes the type's label.
    #[sqlx::test(migrations = "../migrations")]
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
        assert_eq!(updated.type_label, "PEA");

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
    #[sqlx::test(migrations = "../migrations")]
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
    #[sqlx::test(migrations = "../migrations")]
    async fn accounts_lists_only_own(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let list = accounts(State(pool.clone()), auth(alice.user))
            .await
            .expect("list ok")
            .0;
        let ids: Vec<String> = list.into_iter().map(|a| a.id).collect();
        assert_eq!(ids, vec![alice.account.to_string()]);
    }

    /// The transactions list shows only the caller's transactions.
    #[sqlx::test(migrations = "../migrations")]
    async fn transactions_lists_only_own(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let list = transactions(
            State(pool.clone()),
            auth(alice.user),
            Query(no_txn_filters()),
        )
        .await
        .expect("list ok")
        .0;
        let descriptions: Vec<Option<String>> = list.into_iter().map(|t| t.description).collect();
        assert_eq!(descriptions, vec![Some("alice-txn".to_string())]);
    }

    /// Filtering on another user's account id returns nothing rather than
    /// that account's rows.
    #[sqlx::test(migrations = "../migrations")]
    async fn transactions_account_filter_cannot_reach_another_user(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        let bob = seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let list = transactions(
            State(pool.clone()),
            auth(bob.user),
            Query(TransactionParams {
                account_id: Some(alice.account),
                ..no_txn_filters()
            }),
        )
        .await
        .expect("list ok")
        .0;
        assert!(list.is_empty());
    }

    /// The account-type picker is served from the reference table, with labels.
    #[sqlx::test(migrations = "../migrations")]
    async fn account_types_lists_reference_types(pool: PgPool) {
        let list = account_types(State(pool.clone())).await.expect("ok").0;
        let pea = list
            .iter()
            .find(|t| t.key == "pea")
            .expect("pea is a seeded type");
        assert_eq!(pea.label, "PEA");
    }
}
