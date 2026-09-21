//! Budget HTTP surface: the taxonomy, its tags, and what a user does to a
//! transaction. Kept out of `handlers.rs`, which is already 2 884 lines.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::AuthUser;
use gripsou_core::repo::budget::{assign, category, tag};
use gripsou_core::repo::query::{TypeBucket, matching_transaction_ids, transaction_counts};

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".into())
}

fn not_found() -> (StatusCode, String) {
    (StatusCode::NOT_FOUND, "not found".into())
}

/// Maps a `(user_id, name)` unique-constraint violation to 409, leaving every
/// other error as a 500. Shared by every category/tag write site so a
/// duplicate name never surfaces as an opaque "internal error" — renaming
/// onto an existing name is an ordinary thing a user does in the UI.
fn conflict_on_duplicate_name(
    e: gripsou_core::error::CoreError,
    msg: &'static str,
) -> (StatusCode, String) {
    if let gripsou_core::error::CoreError::Db(sqlx::Error::Database(ref db)) = e
        && db.is_unique_violation()
    {
        return (StatusCode::CONFLICT, msg.into());
    }
    internal(e)
}

// ── Categories ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryDto {
    pub id: String,
    pub name: String,
    /// Present only on a seeded row the user has not renamed; the frontend
    /// translates it and falls back to `name`.
    pub default_key: Option<String>,
    pub color: String,
    pub icon: Option<String>,
    pub hint: Option<String>,
    pub kind: String,
    /// Non-null means the row is a system category: undeletable, kind locked.
    pub system_key: Option<String>,
    pub archived: bool,
    pub tx_count: i64,
}

impl From<category::BudgetCategoryRow> for CategoryDto {
    fn from(r: category::BudgetCategoryRow) -> Self {
        CategoryDto {
            id: r.id.to_string(),
            name: r.name,
            default_key: r.default_key,
            color: r.color,
            icon: r.icon,
            hint: r.hint,
            kind: r.kind,
            system_key: r.system_key,
            archived: r.archived,
            tx_count: r.tx_count,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryBody {
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub hint: Option<String>,
    pub kind: String,
    #[serde(default)]
    pub archived: bool,
}

const KINDS: [&str; 4] = ["expense", "income", "internal", "excluded"];

pub async fn list_categories(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<CategoryDto>>, (StatusCode, String)> {
    let rows = category::list_categories(&pool, user_id)
        .await
        .map_err(internal)?;
    Ok(Json(rows.into_iter().map(CategoryDto::from).collect()))
}

pub async fn create_category(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(b): Json<CategoryBody>,
) -> Result<(StatusCode, Json<CategoryDto>), (StatusCode, String)> {
    if b.name.trim().is_empty() || !KINDS.contains(&b.kind.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "invalid name or kind".into()));
    }
    let row = category::create_category(
        &pool,
        user_id,
        &category::NewCategory {
            name: b.name.trim(),
            color: &b.color,
            icon: b.icon.as_deref(),
            hint: b.hint.as_deref().filter(|h| !h.trim().is_empty()),
            kind: &b.kind,
        },
    )
    .await
    .map_err(|e| conflict_on_duplicate_name(e, "a category with this name exists"))?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

pub async fn update_category(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<CategoryBody>,
) -> Result<Json<CategoryDto>, (StatusCode, String)> {
    if b.name.trim().is_empty() || !KINDS.contains(&b.kind.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "invalid name or kind".into()));
    }
    let row = category::update_category(
        &pool,
        user_id,
        id,
        &category::CategoryPatch {
            name: b.name.trim(),
            color: &b.color,
            icon: b.icon.as_deref(),
            hint: b.hint.as_deref().filter(|h| !h.trim().is_empty()),
            kind: &b.kind,
            archived: b.archived,
        },
    )
    .await
    .map_err(|e| conflict_on_duplicate_name(e, "a category with this name exists"))?
    .ok_or_else(not_found)?;
    Ok(Json(row.into()))
}

pub async fn delete_category(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    // A system row is refused with 409, not 404: the UI draws a lock for it,
    // and "not found" would read as a bug.
    let rows = category::list_categories(&pool, user_id)
        .await
        .map_err(internal)?;
    match rows.iter().find(|c| c.id == id) {
        None => Err(not_found()),
        Some(c) if c.system_key.is_some() => Err((
            StatusCode::CONFLICT,
            "this category is written to by internal-transfer pairing and cannot be deleted".into(),
        )),
        Some(_) => {
            category::delete_category(&pool, user_id, id)
                .await
                .map_err(internal)?;
            Ok(StatusCode::NO_CONTENT)
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderBody {
    /// Every category of the user, in the order they should appear.
    pub ids: Vec<String>,
}

/// The client sends the whole list in its new order and the server numbers it.
/// Sending the list rather than "move this row up" keeps the decision where the
/// rows are actually laid out — the client knows which siblings are hidden
/// behind the archived toggle, and the server does not need to.
pub async fn reorder_categories(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(b): Json<ReorderBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let ids = b
        .ids
        .iter()
        .map(|i| Uuid::parse_str(i))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid id".to_string()))?;
    if ids.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "no ids".into()));
    }
    let done = category::reorder_categories(&pool, user_id, &ids)
        .await
        .map_err(internal)?;
    // Every id has to be one of this user's rows: a partial write would leave
    // the list in an order nobody asked for.
    if done != ids.len() as u64 {
        return Err(not_found());
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── Tags ────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDto {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub tx_count: i64,
}

impl From<tag::BudgetTagRow> for TagDto {
    fn from(r: tag::BudgetTagRow) -> Self {
        TagDto {
            id: r.id.to_string(),
            name: r.name,
            color: r.color,
            tx_count: r.tx_count,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagBody {
    pub name: String,
    pub color: Option<String>,
}

pub async fn list_tags(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<TagDto>>, (StatusCode, String)> {
    let rows = tag::list_tags(&pool, user_id).await.map_err(internal)?;
    Ok(Json(rows.into_iter().map(TagDto::from).collect()))
}

pub async fn create_tag(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(b): Json<TagBody>,
) -> Result<(StatusCode, Json<TagDto>), (StatusCode, String)> {
    if b.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "name is required".into()));
    }
    let row = tag::create_tag(&pool, user_id, b.name.trim(), b.color.as_deref())
        .await
        .map_err(|e| conflict_on_duplicate_name(e, "a tag with this name exists"))?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

pub async fn update_tag(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<TagBody>,
) -> Result<Json<TagDto>, (StatusCode, String)> {
    if b.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "name is required".into()));
    }
    let row = tag::update_tag(&pool, user_id, id, b.name.trim(), b.color.as_deref())
        .await
        .map_err(|e| conflict_on_duplicate_name(e, "a tag with this name exists"))?
        .ok_or_else(not_found)?;
    Ok(Json(row.into()))
}

pub async fn delete_tag(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    if tag::delete_tag(&pool, user_id, id)
        .await
        .map_err(internal)?
    {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(not_found())
    }
}

// ── Assignment ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchTransactionBody {
    /// Present and null clears the category; absent leaves it alone.
    #[serde(default, deserialize_with = "double_option")]
    pub category_id: Option<Option<Uuid>>,
    pub tag_ids: Option<Vec<Uuid>>,
    pub checked: Option<bool>,
}

/// Distinguishes `{"categoryId": null}` (clear it) from `{}` (leave it).
fn double_option<'de, D>(d: D) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(d).map(Some)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchTransactionResponse {
    pub ok: bool,
    /// How many *other* transactions share this row's normalised description —
    /// what the "apply to all?" prompt offers.
    pub same_description_count: i64,
}

pub async fn patch_transaction(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<PatchTransactionBody>,
) -> Result<Json<PatchTransactionResponse>, (StatusCode, String)> {
    let mut ok = false;
    if let Some(category_id) = b.category_id {
        ok |= assign::set_category(&pool, user_id, id, category_id)
            .await
            .map_err(internal)?;
    }
    if let Some(tag_ids) = b.tag_ids {
        ok |= assign::set_tags(&pool, user_id, id, &tag_ids)
            .await
            .map_err(internal)?;
    }
    if let Some(checked) = b.checked {
        ok |= assign::set_checked(&pool, user_id, id, checked)
            .await
            .map_err(internal)?;
    }
    if !ok {
        return Err(not_found());
    }
    let same_description_count = assign::count_same_description(&pool, user_id, id)
        .await
        .map_err(internal)?;
    Ok(Json(PatchTransactionResponse {
        ok,
        same_description_count,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyToDescriptionBody {
    pub category_id: Option<Uuid>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedResponse {
    pub updated: i64,
}

pub async fn apply_to_description(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<ApplyToDescriptionBody>,
) -> Result<Json<UpdatedResponse>, (StatusCode, String)> {
    let updated = assign::apply_category_to_same_description(&pool, user_id, id, b.category_id)
        .await
        .map_err(internal)?;
    Ok(Json(UpdatedResponse {
        updated: updated as i64,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkBody {
    /// Explicit rows. When absent, `filter` decides the target set — that is
    /// what "select all shown" means with 3.5 years behind an infinite scroll.
    pub ids: Option<Vec<Uuid>>,
    pub filter: Option<crate::handlers::TransactionParams>,
    #[serde(default, deserialize_with = "double_option")]
    pub category_id: Option<Option<Uuid>>,
    pub add_tag_ids: Option<Vec<Uuid>>,
    pub checked: Option<bool>,
}

pub async fn bulk_transactions(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(b): Json<BulkBody>,
) -> Result<Json<UpdatedResponse>, (StatusCode, String)> {
    let ids = match (b.ids, b.filter) {
        (Some(ids), _) => ids,
        (None, Some(params)) => {
            let filters = crate::handlers::filters_from_params(params)?;
            matching_transaction_ids(&pool, user_id, &filters)
                .await
                .map_err(internal)?
        }
        (None, None) => return Err((StatusCode::BAD_REQUEST, "ids or filter required".into())),
    };

    let mut updated = 0u64;
    if let Some(category_id) = b.category_id {
        updated = updated.max(
            assign::bulk_set_category(&pool, user_id, &ids, category_id)
                .await
                .map_err(internal)?,
        );
    }
    if let Some(tag_ids) = b.add_tag_ids
        && !tag_ids.is_empty()
    {
        updated = updated.max(
            assign::bulk_add_tags(&pool, user_id, &ids, &tag_ids)
                .await
                .map_err(internal)?,
        );
    }
    if let Some(checked) = b.checked {
        updated = updated.max(
            assign::bulk_set_checked(&pool, user_id, &ids, checked)
                .await
                .map_err(internal)?,
        );
    }
    Ok(Json(UpdatedResponse {
        updated: updated as i64,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountsDto {
    pub matching: i64,
    pub total: i64,
    pub uncategorized: i64,
}

pub async fn transaction_count_summary(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<crate::handlers::TransactionParams>,
) -> Result<Json<CountsDto>, (StatusCode, String)> {
    let filters = crate::handlers::filters_from_params(p)?;
    let c = transaction_counts(&pool, user_id, &filters)
        .await
        .map_err(internal)?;
    Ok(Json(CountsDto {
        matching: c.matching,
        total: c.total,
        uncategorized: c.uncategorized,
    }))
}

/// The confidence below which an AI guess goes to the review queue. A function
/// rather than a `const` because `Decimal` construction is not const here; it
/// becomes a server setting in phase 5.
pub fn default_review_threshold() -> Decimal {
    Decimal::new(80, 2)
}

/// Parses the comma-separated id parameters the filter panel sends. A filter
/// the server cannot fully honour must never be silently narrowed to a wider
/// one, so any component that fails to parse as a uuid is a 400 — not a
/// dropped id, which would quietly widen the result set (or, on the bulk
/// endpoint, the write) beyond what the caller asked for.
pub fn parse_ids(raw: Option<&str>) -> Result<Vec<Uuid>, (StatusCode, String)> {
    match raw {
        None => Ok(vec![]),
        // A present-but-blank filter means the same thing as an absent one —
        // the obvious way a frontend clears a filter — so it must not 400.
        Some(s) if s.trim().is_empty() => Ok(vec![]),
        Some(s) => s
            .split(',')
            .map(|p| {
                Uuid::parse_str(p.trim())
                    .map_err(|_| (StatusCode::BAD_REQUEST, format!("invalid id: {p}")))
            })
            .collect(),
    }
}

/// Same loud-failure rule as [`parse_ids`]: an unrecognised bucket is a 400,
/// not a silent fall-through to `all`.
pub fn parse_bucket(raw: Option<&str>) -> Result<TypeBucket, (StatusCode, String)> {
    match raw {
        None => Ok(TypeBucket::default()),
        // A present-but-blank bucket means the same thing as an absent one.
        Some(s) if s.trim().is_empty() => Ok(TypeBucket::default()),
        Some(s) if ["all", "in", "out", "lots"].contains(&s) => Ok(TypeBucket::from_param(s)),
        Some(s) => Err((StatusCode::BAD_REQUEST, format!("invalid bucket: {s}"))),
    }
}

#[cfg(test)]
mod parse_tests {
    use super::*;

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

    /// The property the earlier ruling established must survive: a
    /// non-empty, malformed component is still a 400, never a silently
    /// dropped id.
    #[test]
    fn malformed_id_is_still_a_400() {
        let err = parse_ids(Some("not-a-uuid")).unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);

        let valid = Uuid::new_v4();
        let err = parse_ids(Some(&format!("{valid},also-not-a-uuid"))).unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
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
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }
}
