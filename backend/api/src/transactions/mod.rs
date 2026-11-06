//! The transactions list, its filters and its counts. Writes to a
//! transaction are the budget's (`crate::budget`).

pub mod dto;

use axum::extract::{Query, State};
use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppState;
use crate::auth::AuthUser;
use crate::error::{ApiError, Json};
use axum::Router;
use axum::routing::get;
use gripsou_core::repo::budget::transactions::{self as repo, TransactionFilters, TypeBucket};

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

impl TransactionParams {
    /// The filters these parameters mean for `user_id`, under their own
    /// review threshold. A filter the server cannot fully honour must never be
    /// silently narrowed to a wider one, so an unparseable `categoryIds`/`tagIds`
    /// component or an unrecognised `bucket` is a 400, not a dropped id or a
    /// fall-through to `all`.
    pub async fn filters(
        self,
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<TransactionFilters, ApiError> {
        let review_threshold = gripsou_core::repo::prefs::review_threshold(pool, user_id).await?;
        Ok(TransactionFilters {
            search: self.search.filter(|s| !s.trim().is_empty()),
            account_id: self.account_id,
            bucket: parse_bucket(self.bucket.as_deref())?,
            from: self.from,
            to: self.to,
            category_ids: parse_ids(self.category_ids.as_deref())?,
            tag_ids: parse_ids(self.tag_ids.as_deref())?,
            uncategorized: self.uncategorized.unwrap_or(false),
            needs_review: self.needs_review.unwrap_or(false),
            // Hidden unless asked for: unlike every other filter here, the
            // default is *not* "everything".
            include_transfers: self.include_transfers.unwrap_or(false),
            review_threshold,
            // Capped so a crafted `limit` cannot ask for the whole ledger at once.
            limit: self.limit.unwrap_or(200).clamp(1, 500),
            offset: self.offset.unwrap_or(0).max(0),
        })
    }
}

/// Parses the comma-separated id parameters the filter panel sends; any
/// component that fails to parse is a 400.
fn parse_ids(raw: Option<&str>) -> Result<Vec<Uuid>, ApiError> {
    match raw {
        None => Ok(vec![]),
        // A present-but-blank filter means the same thing as an absent one —
        // the obvious way a frontend clears a filter — so it must not 400.
        Some(s) if s.trim().is_empty() => Ok(vec![]),
        Some(s) => s
            .split(',')
            .map(|p| {
                Uuid::parse_str(p.trim())
                    .map_err(|_| ApiError::BadRequest(format!("invalid id: {p}")))
            })
            .collect(),
    }
}

fn parse_bucket(raw: Option<&str>) -> Result<TypeBucket, ApiError> {
    let s = raw.unwrap_or_default();
    TypeBucket::parse(s).ok_or(ApiError::BadRequest(format!("invalid bucket: {s}")))
}

pub async fn transactions(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<TransactionParams>,
) -> Result<Json<Vec<dto::Transaction>>, ApiError> {
    let filters = p.filters(&pool, user_id).await?;
    let rows = repo::transactions(&pool, user_id, &filters).await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut tags = repo::tags_for_transactions(&pool, user_id, &ids).await?;
    let providers = jobs.providers();
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                let row_tags = tags.remove(&r.id).unwrap_or_default();
                dto::Transaction::from_row(r, row_tags, providers.logos())
            })
            .collect(),
    ))
}

pub async fn transaction_count_summary(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<TransactionParams>,
) -> Result<Json<dto::CountsDto>, ApiError> {
    let filters = p.filters(&pool, user_id).await?;
    let c = repo::transaction_counts(&pool, user_id, &filters).await?;
    Ok(Json(dto::CountsDto {
        matching: c.matching,
        total: c.total,
        uncategorized: c.uncategorized,
        selectable: c.selectable,
        matching_total: c.matching_total.to_string(),
        fx_missing: c.fx_missing,
    }))
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/transactions", get(transactions))
        .route("/transactions/counts", get(transaction_count_summary))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    /// A present-but-blank filter is the frontend's obvious way to clear one,
    /// and means the same thing as the parameter being absent. Reverting the
    /// `s.trim().is_empty()` guard in `parse_ids` would make this 400 again
    /// with "invalid id: ".
    #[test]
    fn empty_ids_param_is_not_an_error() {
        assert_eq!(parse_ids(Some("")).unwrap(), Vec::<Uuid>::new());
        assert_eq!(parse_ids(Some("   ")).unwrap(), Vec::<Uuid>::new());
        assert_eq!(parse_ids(None).unwrap(), Vec::<Uuid>::new());
    }

    /// A non-empty, malformed component is still a 400, never a silently
    /// dropped id.
    #[test]
    fn malformed_id_is_still_a_400() {
        let err = parse_ids(Some("not-a-uuid")).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);

        let valid = Uuid::new_v4();
        let err = parse_ids(Some(&format!("{valid},also-not-a-uuid"))).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn a_real_id_list_still_parses() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        assert_eq!(parse_ids(Some(&format!("{a},{b}"))).unwrap(), vec![a, b]);
    }

    /// Same guard, same reason, for the single `bucket` param: reverting it
    /// would make `bucket=` a 400 ("invalid bucket: ") instead of falling
    /// back to the default.
    #[test]
    fn empty_bucket_param_is_not_an_error() {
        assert_eq!(parse_bucket(Some("")).unwrap(), TypeBucket::default());
        assert_eq!(parse_bucket(None).unwrap(), TypeBucket::default());
    }

    #[test]
    fn unrecognised_bucket_is_still_a_400() {
        let err = parse_bucket(Some("bogus")).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    use crate::testkit::*;
    use sqlx::PgPool;

    fn no_txn_filters() -> TransactionParams {
        serde_json::from_value(serde_json::json!({})).unwrap()
    }

    /// The transactions list shows only the caller's transactions.
    #[sqlx::test(migrations = "../migrations")]
    async fn transactions_lists_only_own(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let list = transactions(
            State(pool.clone()),
            State(deps()),
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
            State(deps()),
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
}
