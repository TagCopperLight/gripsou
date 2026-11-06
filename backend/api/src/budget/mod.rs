//! Budget HTTP surface: the taxonomy, its tags, and what a user does to a
//! transaction.

pub mod dto;
use dto::*;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{ApiError, Json};
use crate::routes::Routes;
use gripsou_core::budget::overview::{
    self,
    calc::{Figures, Month, Period, Slice, SliceAmount},
};
use gripsou_core::repo::budget::transactions::matching_transaction_ids;
use gripsou_core::repo::budget::{ai as ai_repo, assign, category, review, tag};

pub async fn list_categories(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<CategoryDto>>, ApiError> {
    let rows = category::list_categories(&pool, user_id).await?;
    Ok(Json(rows.into_iter().map(CategoryDto::from).collect()))
}

pub async fn create_category(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(b): Json<CategoryBody>,
) -> Result<(StatusCode, Json<CategoryDto>), ApiError> {
    let kind = b.validated()?;
    let row = category::create_category(
        &pool,
        user_id,
        &category::NewCategory {
            name: b.name.trim(),
            color: &b.color,
            icon: b.icon.as_deref(),
            hint: b.hint.as_deref().filter(|h| !h.trim().is_empty()),
            kind,
        },
    )
    .await
    .map_err(ApiError::conflict_on_unique(
        "a category with this name exists",
    ))?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

pub async fn update_category(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<CategoryBody>,
) -> Result<Json<CategoryDto>, ApiError> {
    let kind = b.validated()?;
    let row = category::update_category(
        &pool,
        user_id,
        id,
        &category::CategoryPatch {
            name: b.name.trim(),
            color: &b.color,
            icon: b.icon.as_deref(),
            hint: b.hint.as_deref().filter(|h| !h.trim().is_empty()),
            kind,
            archived: b.archived,
        },
    )
    .await
    .map_err(ApiError::conflict_on_unique(
        "a category with this name exists",
    ))?
    .ok_or(ApiError::NotFound("not found"))?;
    Ok(Json(row.into()))
}

pub async fn delete_category(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    // A system row is refused with 409, not 404: the UI draws a lock for it,
    // and "not found" would read as a bug.
    match category::delete_category(&pool, user_id, id).await? {
        category::DeleteCategory::Deleted => Ok(StatusCode::NO_CONTENT),
        category::DeleteCategory::NotFound => Err(ApiError::NotFound("not found")),
        category::DeleteCategory::System => Err(ApiError::Conflict(
            "this category is written to by internal-transfer pairing and cannot be deleted",
        )),
    }
}

/// The client sends the whole list in its new order and the server numbers it.
/// Sending the list rather than "move this row up" keeps the decision where the
/// rows are actually laid out — the client knows which siblings are hidden
/// behind the archived toggle, and the server does not need to.
pub async fn reorder_categories(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(b): Json<ReorderBody>,
) -> Result<StatusCode, ApiError> {
    let ids = b
        .ids
        .iter()
        .map(|i| Uuid::parse_str(i))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ApiError::bad_request("invalid id"))?;
    if ids.is_empty() {
        return Err(ApiError::bad_request("no ids"));
    }
    if ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len() {
        return Err(ApiError::bad_request("duplicate id"));
    }
    if !category::reorder_categories(&pool, user_id, &ids).await? {
        return Err(ApiError::NotFound("not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_tags(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<TagDto>>, ApiError> {
    let rows = tag::list_tags(&pool, user_id).await?;
    Ok(Json(rows.into_iter().map(TagDto::from).collect()))
}

pub async fn create_tag(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(b): Json<TagBody>,
) -> Result<(StatusCode, Json<TagDto>), ApiError> {
    if b.name.trim().is_empty() {
        return Err(ApiError::bad_request("name is required"));
    }
    let row = tag::create_tag(&pool, user_id, b.name.trim(), b.color.as_deref())
        .await
        .map_err(ApiError::conflict_on_unique("a tag with this name exists"))?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

pub async fn update_tag(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<TagBody>,
) -> Result<Json<TagDto>, ApiError> {
    if b.name.trim().is_empty() {
        return Err(ApiError::bad_request("name is required"));
    }
    let row = tag::update_tag(&pool, user_id, id, b.name.trim(), b.color.as_deref())
        .await
        .map_err(ApiError::conflict_on_unique("a tag with this name exists"))?
        .ok_or(ApiError::NotFound("not found"))?;
    Ok(Json(row.into()))
}

pub async fn delete_tag(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    if tag::delete_tag(&pool, user_id, id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("not found"))
    }
}

fn period_from(p: &SummaryParams) -> Result<Period, ApiError> {
    match (&p.month, p.from, p.to) {
        (Some(m), None, None) => Month::parse(m)
            .map(Period::Month)
            .ok_or(ApiError::BadRequest(format!("invalid month: {m}"))),
        (None, Some(from), Some(to)) if from <= to => Ok(Period::Range { from, to }),
        (None, Some(from), Some(to)) => Err(ApiError::BadRequest(format!(
            "from {from} is after to {to}"
        ))),
        // Same loud-failure rule as parse_ids/parse_bucket: an ambiguous
        // period must never be silently resolved to one reading.
        _ => Err(ApiError::bad_request(
            "pass either month, or both from and to",
        )),
    }
}

/// The user's categories by id, as chips.
async fn category_refs(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<HashMap<Uuid, CategoryRefDto>, ApiError> {
    let rows = category::category_refs(pool, user_id).await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let dto = CategoryRefDto {
                id: r.id.to_string(),
                name: r.name,
                default_key: r.default_key,
                color: r.color,
                icon: r.icon,
            };
            (r.id, dto)
        })
        .collect())
}

/// The chip payload for a slice. A category deleted since the rows were read
/// shows as uncategorised, which is what its rows are.
fn slice_dto(slice: Slice, refs: &HashMap<Uuid, CategoryRefDto>) -> SliceDto {
    match slice {
        Slice::Uncategorised => SliceDto::Uncategorised,
        Slice::Other => SliceDto::Other,
        Slice::Category(id) => match refs.get(&id) {
            Some(r) => SliceDto::Category {
                category: r.clone(),
            },
            None => SliceDto::Uncategorised,
        },
    }
}

/// A twelve-month mean, to the cent: dividing by the month count otherwise
/// sends up to 28 digits.
fn mean_to_string(d: Decimal) -> String {
    d.round_dp_with_strategy(2, rust_decimal::RoundingStrategy::MidpointAwayFromZero)
        .to_string()
}

fn figure(amount: Decimal, prev: Option<Decimal>, avg: Option<Decimal>) -> FigureDto {
    FigureDto {
        amount: amount.to_string(),
        prev_month: prev.map(|d| d.to_string()),
        avg12: avg.map(mean_to_string),
    }
}

fn slice_amounts(
    slices: &[SliceAmount],
    refs: &HashMap<Uuid, CategoryRefDto>,
) -> Vec<SliceAmountDto> {
    slices
        .iter()
        .map(|x| SliceAmountDto {
            slice: slice_dto(x.slice, refs),
            amount: x.amount.to_string(),
        })
        .collect()
}

pub async fn summary(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<SummaryParams>,
) -> Result<Json<SummaryDto>, ApiError> {
    let period = period_from(&p)?;
    let s = overview::summary(&pool, user_id, period).await?;
    let refs = category_refs(&pool, user_id).await?;

    let prev = s.comparison.map(|c| c.prev_month);
    let avg = s.comparison.map(|c| c.avg12);
    let pick = |field: fn(&Figures) -> Decimal| {
        figure(
            field(&s.figures),
            prev.as_ref().map(field),
            avg.as_ref().map(field),
        )
    };
    Ok(Json(SummaryDto {
        txn_count: s.txn_count,
        fx_missing: s.fx_missing,
        figures: FiguresDto {
            income: pick(|f| f.income),
            expenses: pick(|f| f.expenses),
            net: pick(|f| f.net),
        },
        sankey: SankeyDto {
            sources: slice_amounts(&s.sankey.sources, &refs),
            destinations: slice_amounts(&s.sankey.destinations, &refs),
            not_spent: s.sankey.not_spent.map(|d| d.to_string()),
            drawn_from_savings: s.sankey.drawn_from_savings.map(|d| d.to_string()),
        },
        breakdown: s
            .breakdown
            .into_iter()
            .map(|e| BreakdownRowDto {
                slice: slice_dto(e.slice, &refs),
                amount: e.amount.to_string(),
                txn_count: e.txn_count,
                avg12: e.avg12.map(mean_to_string),
            })
            .collect(),
    }))
}

/// More than this and the chart is unreadable and the window pointlessly wide.
pub const MAX_TREND_MONTHS: u32 = 24;

/// The trend chart's own default width, deliberately not the summary's
/// baseline length even though both are 12: the chart's bars end with the
/// anchor month included, while the baseline excludes the selected month. The
/// two are free to diverge.
pub const TREND_DEFAULT_MONTHS: u32 = 12;

pub async fn trend_handler(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<TrendParams>,
) -> Result<Json<TrendDto>, ApiError> {
    let anchor = Month::parse(&p.anchor).ok_or(ApiError::BadRequest(format!(
        "invalid anchor: {}",
        p.anchor
    )))?;
    let months = p.months.unwrap_or(TREND_DEFAULT_MONTHS);
    if months == 0 || months > MAX_TREND_MONTHS {
        return Err(ApiError::BadRequest(format!(
            "months must be 1..={MAX_TREND_MONTHS}"
        )));
    }

    let trend = overview::trend_for(&pool, user_id, anchor, months).await?;
    let refs = category_refs(&pool, user_id).await?;

    Ok(Json(TrendDto {
        months: trend.months.iter().map(|m| m.label()).collect(),
        series: trend
            .series
            .into_iter()
            .map(|s| TrendSeriesDto {
                slice: slice_dto(s.slice, &refs),
                values: s.values.iter().map(|v| v.to_string()).collect(),
            })
            .collect(),
    }))
}

/// Resolves `scope` against the reader's own review threshold.
async fn same_description(
    pool: &PgPool,
    user_id: Uuid,
    scope: Scope,
) -> Result<assign::SameDescription, ApiError> {
    Ok(match scope {
        Scope::All => assign::SameDescription::All,
        Scope::Review => assign::SameDescription::NeedsReview(
            gripsou_core::repo::prefs::review_threshold(pool, user_id).await?,
        ),
    })
}

impl From<assign::Refusal> for ApiError {
    fn from(r: assign::Refusal) -> Self {
        match r {
            assign::Refusal::NotFound => ApiError::NotFound("not found"),
            assign::Refusal::UnknownCategory => ApiError::Unprocessable("unknown category"),
            assign::Refusal::UnknownTag => ApiError::Unprocessable("unknown tag"),
        }
    }
}

/// Category, tags and ✓ are saved together or not at all.
pub async fn patch_transaction(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<PatchTransactionBody>,
) -> Result<Json<PatchTransactionResponse>, ApiError> {
    if b.category_id.is_none() && b.tag_ids.is_none() && b.checked.is_none() {
        return Err(ApiError::bad_request("nothing to change"));
    }
    let patch = assign::TransactionPatch {
        category_id: b.category_id,
        tag_ids: b.tag_ids.as_deref(),
        checked: b.checked,
    };
    match assign::patch_transaction(&pool, user_id, id, &patch, b.confirm_break_pairs).await? {
        assign::WriteOutcome::Done(()) => {}
        assign::WriteOutcome::PendingPairBreaks(n) => {
            return Ok(Json(PatchTransactionResponse {
                same_description_count: None,
                pending_pair_breaks: Some(n),
            }));
        }
        assign::WriteOutcome::Refused(r) => return Err(r.into()),
    }
    // Only a category change makes "apply to the others?" a question.
    let same_description_count = match b.category_id {
        Some(_) => {
            let scope = same_description(&pool, user_id, b.offer_scope).await?;
            Some(assign::count_same_description(&pool, user_id, id, scope).await?)
        }
        None => None,
    };
    Ok(Json(PatchTransactionResponse {
        same_description_count,
        pending_pair_breaks: None,
    }))
}

pub async fn apply_to_description(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<ApplyToDescriptionBody>,
) -> Result<Json<UpdatedResponse>, ApiError> {
    let scope = same_description(&pool, user_id, b.scope).await?;
    let outcome = assign::apply_to_description(
        &pool,
        user_id,
        id,
        b.category_id,
        scope,
        b.confirm_break_pairs,
    )
    .await?;
    UpdatedResponse::answer(outcome.map(|ids| (ids.len() as i64, Some(ids)))).map(Json)
}

/// More explicit ids than a selection of loaded rows can reach; a larger
/// target goes through `filter`.
const MAX_BULK_IDS: usize = 10_000;

pub async fn bulk_transactions(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(b): Json<BulkBody>,
) -> Result<Json<UpdatedResponse>, ApiError> {
    let ids = match (b.ids, b.filter) {
        (Some(_), Some(_)) => {
            return Err(ApiError::bad_request("send ids or filter, not both"));
        }
        (Some(ids), None) if ids.len() > MAX_BULK_IDS => {
            return Err(ApiError::BadRequest(format!(
                "at most {MAX_BULK_IDS} ids; use a filter"
            )));
        }
        (Some(ids), None) => ids,
        (None, Some(params)) => {
            let filters = params.filters(&pool, user_id).await?;
            matching_transaction_ids(&pool, user_id, &filters).await?
        }
        (None, None) => return Err(ApiError::bad_request("ids or filter required")),
    };

    let outcome = assign::bulk_apply(
        &pool,
        user_id,
        &ids,
        assign::BulkChanges {
            category_id: b.category_id,
            add_tag_ids: b.add_tag_ids.as_deref(),
            checked: b.checked,
        },
        b.confirm_break_pairs,
    )
    .await?;
    UpdatedResponse::answer(outcome.map(|n| (n as i64, None))).map(Json)
}

pub async fn categorize_status(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<dto::AiStatusDto>, ApiError> {
    let configured = gripsou_jobs::ai_configured(&pool, &jobs).await?;
    let threshold = gripsou_core::repo::prefs::review_threshold(&pool, user_id).await?;
    let last = ai_repo::last_run(&pool, user_id).await?;
    Ok(Json(dto::AiStatusDto {
        configured,
        running: gripsou_jobs::ai_running(user_id),
        remaining: ai_repo::remaining(&pool, user_id).await?,
        review_count: review::review_count(&pool, user_id, threshold).await?,
        last_run: last.map(|r| dto::AiLastRunDto {
            outcome: r.outcome,
            error: r.error,
            started_at: r.started_at.to_rfc3339(),
        }),
    }))
}

pub async fn request_categorize(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<StatusCode, ApiError> {
    if !gripsou_jobs::categorize_ready(&pool, &jobs, user_id).await {
        return Err(ApiError::Conflict("no AI categorisation for this user"));
    }
    gripsou_jobs::request_categorize(pool, jobs, user_id);
    Ok(StatusCode::ACCEPTED)
}

fn review_result(w: review::ReviewWrite) -> Result<StatusCode, ApiError> {
    match w {
        review::ReviewWrite::Done => Ok(StatusCode::NO_CONTENT),
        review::ReviewWrite::NotFound => Err(ApiError::NotFound("not found")),
        review::ReviewWrite::Refused => Err(ApiError::Conflict("not in review")),
        review::ReviewWrite::BadConfidence => {
            Err(ApiError::bad_request("confidence must be between 0 and 1"))
        }
    }
}

pub async fn accept_review(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AcceptReviewResponse>, ApiError> {
    review_result(review::accept(&pool, user_id, id).await?)?;
    let scope = same_description(&pool, user_id, Scope::Review).await?;
    let same_description_count = assign::count_same_description(&pool, user_id, id, scope).await?;
    Ok(Json(AcceptReviewResponse {
        same_description_count,
    }))
}

pub async fn undo_review(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::UndoReviewReq>,
) -> Result<StatusCode, ApiError> {
    review_result(review::undo(&pool, user_id, id, body.category_id, body.confidence).await?)
}

pub(crate) fn routes() -> Routes {
    Routes::default()
        .patch("/transactions/{id}", patch_transaction)
        .post(
            "/transactions/{id}/apply-to-description",
            apply_to_description,
        )
        .post("/transactions/bulk", bulk_transactions)
        .get("/budget/categories", list_categories)
        .post("/budget/categories", create_category)
        .put("/budget/categories/order", reorder_categories)
        .patch("/budget/categories/{id}", update_category)
        .delete("/budget/categories/{id}", delete_category)
        .get("/budget/tags", list_tags)
        .post("/budget/tags", create_tag)
        .patch("/budget/tags/{id}", update_tag)
        .delete("/budget/tags/{id}", delete_tag)
        .get("/budget/summary", summary)
        .get("/budget/trend", trend_handler)
        .post("/budget/categorize", request_categorize)
        .get("/budget/categorize/status", categorize_status)
        .post("/budget/review/{id}/accept", accept_review)
        .post("/budget/review/{id}/undo", undo_review)
}

#[cfg(test)]
mod tests;
