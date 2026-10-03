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
use gripsou_core::repo::budget::{ai as ai_repo, assign, category, review, tag};
use gripsou_core::repo::query::{TypeBucket, matching_transaction_ids, transaction_counts};

use chrono::NaiveDate;
use gripsou_core::budget::overview::{
    BASELINE_MONTHS, Baseline, BreakdownEntry, Figures, Month, Slice, baseline_figures,
    baseline_in, breakdown, by_month, figures, month_rows, sankey,
};
use std::collections::BTreeMap;

use gripsou_core::repo::budget::summary::{DayCategoryRow, day_category_totals};

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

const KINDS: [&str; 3] = ["expense", "income", "neutral"];

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
    match category::delete_category(&pool, user_id, id)
        .await
        .map_err(internal)?
    {
        category::DeleteCategory::Deleted => Ok(StatusCode::NO_CONTENT),
        category::DeleteCategory::NotFound => Err(not_found()),
        category::DeleteCategory::System => Err((
            StatusCode::CONFLICT,
            "this category is written to by internal-transfer pairing and cannot be deleted".into(),
        )),
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
    if ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len() {
        return Err((StatusCode::BAD_REQUEST, "duplicate id".into()));
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

// ── Overview ────────────────────────────────────────────────────────────────

/// The category fields a chip needs, and no more. Same shape the transactions
/// list already sends, so the frontend's `CategoryChip` is reused verbatim.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRefDto {
    pub id: String,
    pub name: String,
    pub default_key: Option<String>,
    pub color: String,
    pub icon: Option<String>,
}

/// One discriminated union for the Sankey's nodes, the breakdown's rows and
/// the trend's series, so the chip has a single input shape everywhere.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SliceDto {
    Category { category: CategoryRefDto },
    Uncategorised,
    Other,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceAmountDto {
    pub slice: SliceDto,
    pub amount: String,
}

/// A headline figure and its two comparisons. Amounts, never percentages: the
/// frontend owns the formatting and the arrow/colour logic.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigureDto {
    pub amount: String,
    /// Absent, not null, under a custom range or with too little history.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prev_month: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg12: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownRowDto {
    pub slice: SliceDto,
    pub amount: String,
    pub txn_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg12: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SankeyDto {
    pub sources: Vec<SliceAmountDto>,
    pub destinations: Vec<SliceAmountDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_spent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drawn_from_savings: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiguresDto {
    pub income: FigureDto,
    pub expenses: FigureDto,
    pub net: FigureDto,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryDto {
    /// Sum of `txn_count` across every `(day, category)` row in the period —
    /// NOT the count on the Transactions list header for the same month.
    /// Paired transfers, neutral rows and lot rows are all left out here; the
    /// list shows lots and neutral rows (internal transfers on request).
    pub txn_count: i64,
    pub fx_missing: bool,
    /// Nothing is missing from these figures — the whole sum is in the
    /// pivot currency, because the reader's reporting currency had no rate.
    pub reporting_fx_missing: bool,
    pub figures: FiguresDto,
    pub sankey: SankeyDto,
    pub breakdown: Vec<BreakdownRowDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryParams {
    pub month: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

/// The period, and whether it is comparable against neighbouring months.
///
/// `from`/`to` alone cannot express the distinction: "September 2026" and "a
/// custom range that happens to run 1-30 September" are the same two dates and
/// must produce different payloads.
fn period_from(
    p: &SummaryParams,
) -> Result<(NaiveDate, NaiveDate, Option<Month>), (StatusCode, String)> {
    match (&p.month, p.from, p.to) {
        (Some(m), None, None) => {
            let month =
                Month::parse(m).ok_or((StatusCode::BAD_REQUEST, format!("invalid month: {m}")))?;
            let (from, to) = month.bounds();
            Ok((from, to, Some(month)))
        }
        (None, Some(from), Some(to)) if from <= to => Ok((from, to, None)),
        (None, Some(from), Some(to)) => Err((
            StatusCode::BAD_REQUEST,
            format!("from {from} is after to {to}"),
        )),
        // Same loud-failure rule as parse_ids/parse_bucket: an ambiguous
        // period must never be silently resolved to one reading.
        _ => Err((
            StatusCode::BAD_REQUEST,
            "pass either month, or both from and to".into(),
        )),
    }
}

/// Build the chip payload for a slice. Categories the user has since deleted
/// cannot appear — the column is `on delete set null`, so their rows are
/// already uncategorised by the time they are read.
fn slice_dto(slice: Slice, refs: &[CategoryRefDto]) -> SliceDto {
    match slice {
        Slice::Uncategorised => SliceDto::Uncategorised,
        Slice::Other => SliceDto::Other,
        Slice::Category(id) => match refs.iter().find(|r| r.id == id.to_string()) {
            Some(r) => SliceDto::Category {
                category: r.clone(),
            },
            None => SliceDto::Uncategorised,
        },
    }
}

async fn category_refs(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<CategoryRefDto>, (StatusCode, String)> {
    let rows = category::category_refs(pool, user_id)
        .await
        .map_err(internal)?;
    Ok(rows
        .into_iter()
        .map(|r| CategoryRefDto {
            id: r.id.to_string(),
            name: r.name,
            default_key: r.default_key,
            color: r.color,
            icon: r.icon,
        })
        .collect())
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

pub async fn summary(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<SummaryParams>,
) -> Result<Json<SummaryDto>, (StatusCode, String)> {
    let (from, to, month) = period_from(&p)?;

    // One fetch wide enough for the period AND its baseline, so nothing here
    // can disagree with anything else on the page. The baseline is the twelve
    // months before the selected one, hence `minus(12)`.
    let window_from = match month {
        Some(m) => m.minus(BASELINE_MONTHS).bounds().0,
        None => from,
    };
    let all = day_category_totals(&pool, user_id, window_from, to)
        .await
        .map_err(internal)?;

    // A month period reads its rows, its previous month and its baseline off
    // one grouping of the window. A custom range fetched exactly its own
    // days, so the window is the period.
    let buckets: Option<BTreeMap<Month, Vec<DayCategoryRow>>> = month.map(|_| by_month(&all));
    let period: &[DayCategoryRow] = match (month, &buckets) {
        (Some(m), Some(b)) => month_rows(b, m),
        _ => &all,
    };
    let f = figures(period);
    let refs = category_refs(&pool, user_id).await?;

    // Comparisons exist only for a month period with enough history behind it.
    let base: Option<Baseline> = month
        .zip(buckets.as_ref())
        .and_then(|(m, b)| baseline_in(b, m));
    let base_f: Option<Figures> = base.as_ref().map(baseline_figures);
    let prev_f: Option<Figures> = month
        .zip(buckets.as_ref())
        .filter(|_| base.is_some())
        .map(|(m, b)| figures(month_rows(b, m.prev())));

    // `sankey()` computes `figures(rows)` internally for the balancing
    // remainder — it takes only the rows, never a caller-supplied total.
    let s = sankey(period);
    let rows = breakdown(period, base.as_ref());

    Ok(Json(SummaryDto {
        txn_count: period.iter().map(|r| r.txn_count).sum(),
        fx_missing: period.iter().any(|r| r.fx_missing),
        reporting_fx_missing: period.iter().any(|r| r.reporting_fx_missing),
        figures: FiguresDto {
            income: figure(f.income, prev_f.map(|x| x.income), base_f.map(|x| x.income)),
            expenses: figure(
                f.expenses,
                prev_f.map(|x| x.expenses),
                base_f.map(|x| x.expenses),
            ),
            net: figure(f.net, prev_f.map(|x| x.net), base_f.map(|x| x.net)),
        },
        sankey: SankeyDto {
            sources: s
                .sources
                .iter()
                .map(|x| SliceAmountDto {
                    slice: slice_dto(x.slice, &refs),
                    amount: x.amount.to_string(),
                })
                .collect(),
            destinations: s
                .destinations
                .iter()
                .map(|x| SliceAmountDto {
                    slice: slice_dto(x.slice, &refs),
                    amount: x.amount.to_string(),
                })
                .collect(),
            not_spent: s.not_spent.map(|d| d.to_string()),
            drawn_from_savings: s.drawn_from_savings.map(|d| d.to_string()),
        },
        breakdown: rows
            .into_iter()
            .map(|e: BreakdownEntry| BreakdownRowDto {
                slice: slice_dto(e.slice, &refs),
                amount: e.amount.to_string(),
                txn_count: e.txn_count,
                avg12: e.avg12.map(mean_to_string),
            })
            .collect(),
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendSeriesDto {
    pub slice: SliceDto,
    pub values: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendDto {
    /// `["2025-10", ..., "2026-09"]` — `months` entries ending at `anchor`.
    pub months: Vec<String>,
    pub series: Vec<TrendSeriesDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendParams {
    /// `"2026-09"`. Required: stepping back to March 2024 must compare against
    /// 2024, not against whenever the request happened to be made.
    pub anchor: String,
    pub months: Option<u32>,
}

/// More than this and the chart is unreadable and the window pointlessly wide.
const MAX_TREND_MONTHS: u32 = 24;

/// The trend chart's own default width, deliberately not `BASELINE_MONTHS`
/// even though both happen to be 12 today: the chart and the baseline are
/// different windows on purpose — the chart's default bars end
/// with the anchor month included, while the baseline that `summary()` mixes
/// in explicitly excludes it. Sharing one constant would make that
/// distinction a coincidence instead of a rule, and the two must be free to
/// diverge without one silently dragging the other along.
const TREND_DEFAULT_MONTHS: u32 = 12;

pub async fn trend_handler(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<TrendParams>,
) -> Result<Json<TrendDto>, (StatusCode, String)> {
    let anchor = Month::parse(&p.anchor).ok_or((
        StatusCode::BAD_REQUEST,
        format!("invalid anchor: {}", p.anchor),
    ))?;
    let months = p.months.unwrap_or(TREND_DEFAULT_MONTHS);
    if months == 0 || months > MAX_TREND_MONTHS {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("months must be 1..={MAX_TREND_MONTHS}"),
        ));
    }

    let from = anchor.minus(months - 1).bounds().0;
    let to = anchor.bounds().1;
    let rows = day_category_totals(&pool, user_id, from, to)
        .await
        .map_err(internal)?;

    let (axis, series) = gripsou_core::budget::overview::trend(&rows, anchor, months);
    let refs = category_refs(&pool, user_id).await?;

    Ok(Json(TrendDto {
        months: axis.iter().map(|m| m.label()).collect(),
        series: series
            .into_iter()
            .map(|s| TrendSeriesDto {
                slice: slice_dto(s.slice, &refs),
                values: s.values.iter().map(|v| v.to_string()).collect(),
            })
            .collect(),
    }))
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
    /// See `ApplyToDescriptionBody::confirm_break_pairs`: a category change
    /// on half of an internal transfer waits for it.
    #[serde(default)]
    pub confirm_break_pairs: bool,
}

/// Distinguishes `{"categoryId": null}` (clear it) from `{}` (leave it).
fn double_option<'de, D>(d: D) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(d).map(Some)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PatchTransactionResponse {
    /// How many *other* transactions share this row's normalised description —
    /// what the "apply to all?" prompt offers. Present only when the category
    /// was written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub same_description_count: Option<i64>,
    /// Same meaning as `UpdatedResponse::pending_pair_breaks`: non-null means
    /// nothing was written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_pair_breaks: Option<i64>,
}

/// The refusals every assignment write shares.
fn write_refused<T>(o: assign::WriteOutcome<T>) -> (StatusCode, String) {
    match o {
        assign::WriteOutcome::NotFound => not_found(),
        assign::WriteOutcome::UnknownCategory => {
            (StatusCode::UNPROCESSABLE_ENTITY, "unknown category".into())
        }
        assign::WriteOutcome::UnknownTag => {
            (StatusCode::UNPROCESSABLE_ENTITY, "unknown tag".into())
        }
        assign::WriteOutcome::Done(_) | assign::WriteOutcome::PendingPairBreaks(_) => {
            internal("write_refused called on an accepted write")
        }
    }
}

/// Category, tags and ✓ are saved together or not at all.
pub async fn patch_transaction(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<PatchTransactionBody>,
) -> Result<Json<PatchTransactionResponse>, (StatusCode, String)> {
    if b.category_id.is_none() && b.tag_ids.is_none() && b.checked.is_none() {
        return Err((StatusCode::BAD_REQUEST, "nothing to change".into()));
    }
    let patch = assign::TransactionPatch {
        category_id: b.category_id,
        tag_ids: b.tag_ids.as_deref(),
        checked: b.checked,
    };
    match assign::patch_transaction(&pool, user_id, id, &patch, b.confirm_break_pairs)
        .await
        .map_err(internal)?
    {
        assign::WriteOutcome::Done(()) => {}
        assign::WriteOutcome::PendingPairBreaks(n) => {
            return Ok(Json(PatchTransactionResponse {
                same_description_count: None,
                pending_pair_breaks: Some(n),
            }));
        }
        other => return Err(write_refused(other)),
    }
    // Only a category change makes "apply to the others?" a question.
    let same_description_count = match b.category_id {
        Some(_) => Some(
            assign::count_same_description(&pool, user_id, id)
                .await
                .map_err(internal)?,
        ),
        None => None,
    };
    Ok(Json(PatchTransactionResponse {
        same_description_count,
        pending_pair_breaks: None,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyToDescriptionBody {
    pub category_id: Option<Uuid>,
    /// The caller has seen how many internal-transfer pairs this write would
    /// dissolve and wants it applied anyway. Without it, a write that would
    /// break one is refused (see `UpdatedResponse::pending_pair_breaks`).
    #[serde(default)]
    pub confirm_break_pairs: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedResponse {
    pub updated: i64,
    /// Non-null means **nothing was written**: the write would have dissolved
    /// this many internal-transfer pairs and the caller has not confirmed.
    /// Re-send the identical body with `confirmBreakPairs` to go ahead.
    ///
    /// Kept distinct from `updated: 0` on purpose — "wrote no rows" and
    /// "refused, awaiting confirmation" are different answers, and a client
    /// that cannot tell them apart silently swallows the confirmation step.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_pair_breaks: Option<i64>,
    /// The rows written, for apply-to-description only: the review queue
    /// resolves those of its lines this swept up. A bulk write omits it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<Uuid>>,
}

pub async fn apply_to_description(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<ApplyToDescriptionBody>,
) -> Result<Json<UpdatedResponse>, (StatusCode, String)> {
    match assign::apply_to_description(&pool, user_id, id, b.category_id, b.confirm_break_pairs)
        .await
        .map_err(internal)?
    {
        assign::WriteOutcome::Done(ids) => Ok(Json(UpdatedResponse {
            updated: ids.len() as i64,
            pending_pair_breaks: None,
            ids: Some(ids),
        })),
        assign::WriteOutcome::PendingPairBreaks(n) => Ok(Json(UpdatedResponse {
            updated: 0,
            pending_pair_breaks: Some(n),
            ids: None,
        })),
        other => Err(write_refused(other)),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkBody {
    /// Explicit rows, at most [`MAX_BULK_IDS`]. Exactly one of `ids` and
    /// `filter` is sent: `filter` targets every row the list shows under the
    /// same parameters — that is what "select all shown" means with 3.5 years
    /// behind an infinite scroll.
    pub ids: Option<Vec<Uuid>>,
    /// The list's own query parameters, decoded by the same
    /// `filters_from_params`, so an absent `includeTransfers` hides transfers
    /// here exactly as it does in the list.
    pub filter: Option<crate::handlers::TransactionParams>,
    #[serde(default, deserialize_with = "double_option")]
    pub category_id: Option<Option<Uuid>>,
    pub add_tag_ids: Option<Vec<Uuid>>,
    pub checked: Option<bool>,
    /// See `ApplyToDescriptionBody::confirm_break_pairs`.
    #[serde(default)]
    pub confirm_break_pairs: bool,
}

/// More explicit ids than a selection of loaded rows can reach; a larger
/// target goes through `filter`.
const MAX_BULK_IDS: usize = 10_000;

pub async fn bulk_transactions(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(b): Json<BulkBody>,
) -> Result<Json<UpdatedResponse>, (StatusCode, String)> {
    let ids = match (b.ids, b.filter) {
        (Some(_), Some(_)) => {
            return Err((
                StatusCode::BAD_REQUEST,
                "send ids or filter, not both".into(),
            ));
        }
        (Some(ids), None) if ids.len() > MAX_BULK_IDS => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("at most {MAX_BULK_IDS} ids; use a filter"),
            ));
        }
        (Some(ids), None) => ids,
        (None, Some(params)) => {
            let threshold = gripsou_core::repo::prefs::review_threshold(&pool, user_id)
                .await
                .map_err(internal)?;
            let filters = crate::handlers::filters_from_params(params, threshold)?;
            matching_transaction_ids(&pool, user_id, &filters)
                .await
                .map_err(internal)?
        }
        (None, None) => return Err((StatusCode::BAD_REQUEST, "ids or filter required".into())),
    };

    match assign::bulk_apply(
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
    .await
    .map_err(internal)?
    {
        assign::WriteOutcome::Done(n) => Ok(Json(UpdatedResponse {
            updated: n as i64,
            pending_pair_breaks: None,
            ids: None,
        })),
        assign::WriteOutcome::PendingPairBreaks(n) => Ok(Json(UpdatedResponse {
            updated: 0,
            pending_pair_breaks: Some(n),
            ids: None,
        })),
        other => Err(write_refused(other)),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountsDto {
    pub matching: i64,
    pub total: i64,
    pub uncategorized: i64,
    /// Decimal as a string, per the project convention.
    pub matching_total: String,
    /// At least one matching row's account leg could not be valued, so
    /// `matchingTotal` is understated by whatever that row was worth. Same
    /// convention as `SummaryDto.fxMissing`.
    pub fx_missing: bool,
    /// Nothing is missing from `matchingTotal` — the reader's reporting
    /// currency had no rate on at least one matching row's day, so that
    /// row's contribution is in the pivot currency instead. Same convention
    /// as `SummaryDto.reportingFxMissing`.
    pub reporting_fx_missing: bool,
}

pub async fn transaction_count_summary(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<crate::handlers::TransactionParams>,
) -> Result<Json<CountsDto>, (StatusCode, String)> {
    let threshold = gripsou_core::repo::prefs::review_threshold(&pool, user_id)
        .await
        .map_err(internal)?;
    let filters = crate::handlers::filters_from_params(p, threshold)?;
    let c = transaction_counts(&pool, user_id, &filters)
        .await
        .map_err(internal)?;
    Ok(Json(CountsDto {
        matching: c.matching,
        total: c.total,
        uncategorized: c.uncategorized,
        matching_total: c.matching_total.to_string(),
        fx_missing: c.fx_missing,
        reporting_fx_missing: c.reporting_fx_missing,
    }))
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
        Some(s) => {
            TypeBucket::parse(s).ok_or((StatusCode::BAD_REQUEST, format!("invalid bucket: {s}")))
        }
    }
}

pub async fn categorize_status(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<crate::dto::AiStatusDto>, (StatusCode, String)> {
    let settings = gripsou_core::repo::settings::budget_ai(&pool)
        .await
        .map_err(internal)?;
    let configured = settings
        .provider
        .as_deref()
        .is_some_and(|p| gripsou_jobs::available_categorizers().contains(&p));
    let threshold = gripsou_core::repo::prefs::review_threshold(&pool, user_id)
        .await
        .map_err(internal)?;
    let last = ai_repo::last_run(&pool, user_id).await.map_err(internal)?;
    Ok(Json(crate::dto::AiStatusDto {
        configured,
        running: ai_repo::is_locked(&pool, user_id).await.map_err(internal)?,
        remaining: ai_repo::remaining(&pool, user_id).await.map_err(internal)?,
        review_count: review::review_count(&pool, user_id, threshold)
            .await
            .map_err(internal)?,
        last_run: last.map(|r| crate::dto::AiLastRunDto {
            outcome: r.outcome,
            error: r.error,
        }),
    }))
}

pub async fn request_categorize(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> StatusCode {
    if !gripsou_jobs::categorize_ready(&pool, user_id).await {
        return StatusCode::CONFLICT;
    }
    gripsou_jobs::request_categorize(pool, user_id);
    StatusCode::ACCEPTED
}

fn review_status(w: review::ReviewWrite) -> StatusCode {
    match w {
        review::ReviewWrite::Done => StatusCode::NO_CONTENT,
        review::ReviewWrite::NotFound => StatusCode::NOT_FOUND,
        review::ReviewWrite::Refused => StatusCode::CONFLICT,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptReviewResponse {
    /// How many *other* transactions share this row's normalised description —
    /// what the review line's "apply to N others" offers, as after a patch.
    pub same_description_count: i64,
}

pub async fn accept_review(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AcceptReviewResponse>, (StatusCode, String)> {
    match review::accept(&pool, user_id, id).await.map_err(internal)? {
        review::ReviewWrite::Done => {}
        other => return Err((review_status(other), String::new())),
    }
    let same_description_count = assign::count_same_description(&pool, user_id, id)
        .await
        .map_err(internal)?;
    Ok(Json(AcceptReviewResponse {
        same_description_count,
    }))
}

pub async fn undo_review(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<crate::dto::UndoReviewReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    // The only range check: the repository stores what it is given.
    if body
        .confidence
        .is_some_and(|c| c < Decimal::ZERO || c > Decimal::ONE)
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "confidence must be between 0 and 1".into(),
        ));
    }
    Ok(review_status(
        review::undo(&pool, user_id, id, body.category_id, body.confidence)
            .await
            .map_err(internal)?,
    ))
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

#[cfg(test)]
mod handler_tests {
    use super::*;
    use serde_json::json;

    fn auth(user_id: Uuid) -> AuthUser {
        AuthUser {
            user_id,
            session_id: Uuid::new_v4(),
        }
    }

    /// A user with one checking account; returns (user, account).
    async fn seed_user(pool: &PgPool) -> (Uuid, Uuid) {
        let user_id: Uuid = sqlx::query_scalar(
            "insert into users (email, name, password_hash) \
             values (gen_random_uuid()::text || '@t.local', 'T', 'x') returning id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let account_id: Uuid = sqlx::query_scalar(
            "with c as (insert into connection (user_id, provider_key, display_name) \
                        values ($1, 'powens', 'C') returning id) \
             insert into account (connection_id, name, currency, type_key) \
             select id, 'Current', 'EUR', 'checking' from c returning id",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap();
        (user_id, account_id)
    }

    async fn seed_txn(pool: &PgPool, account_id: Uuid, description: &str) -> Uuid {
        sqlx::query_scalar(
            "insert into transaction (account_id, ts, type, amount, description) \
             values ($1, now(), 'withdrawal', -12, $2) returning id",
        )
        .bind(account_id)
        .bind(description)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn category(pool: &PgPool, user_id: Uuid, key: &str) -> Uuid {
        sqlx::query_scalar(
            "select id from budget_category where user_id = $1 \
             and (default_key = $2 or system_key = $2)",
        )
        .bind(user_id)
        .bind(key)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn row(pool: &PgPool, id: Uuid) -> (Option<Uuid>, bool, i64) {
        sqlx::query_as(
            "select t.budget_category_id, t.checked_at is not null, \
                    (select count(*) from budget_transaction_tag g where g.transaction_id = t.id) \
               from transaction t where t.id = $1",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn patch(
        pool: &PgPool,
        user_id: Uuid,
        id: Uuid,
        body: serde_json::Value,
    ) -> Result<PatchTransactionResponse, (StatusCode, String)> {
        patch_transaction(
            State(pool.clone()),
            auth(user_id),
            Path(id),
            Json(serde_json::from_value(body).unwrap()),
        )
        .await
        .map(|j| j.0)
    }

    async fn bulk(
        pool: &PgPool,
        user_id: Uuid,
        body: serde_json::Value,
    ) -> Result<UpdatedResponse, (StatusCode, String)> {
        bulk_transactions(
            State(pool.clone()),
            auth(user_id),
            Json(serde_json::from_value(body).unwrap()),
        )
        .await
        .map(|j| j.0)
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_partial_patch_leaves_the_other_fields_alone(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let id = seed_txn(&pool, account, "LECLERC").await;
        seed_txn(&pool, account, "LECLERC").await;
        let groceries = category(&pool, user_id, "groceries").await;

        let r = patch(&pool, user_id, id, json!({ "categoryId": groceries }))
            .await
            .unwrap();
        assert_eq!(r.same_description_count, Some(1));

        let r = patch(&pool, user_id, id, json!({ "checked": true }))
            .await
            .unwrap();
        assert_eq!(
            r.same_description_count, None,
            "no category change, no question"
        );
        assert_eq!(row(&pool, id).await, (Some(groceries), true, 0));

        let err = patch(&pool, user_id, id, json!({})).await.unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_patch_with_a_foreign_category_fails_whole(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let id = seed_txn(&pool, account, "LECLERC").await;
        let (stranger, _) = seed_user(&pool).await;
        let theirs = category(&pool, stranger, "groceries").await;
        let tag = tag::create_tag(&pool, user_id, "Holiday", None)
            .await
            .unwrap()
            .id;

        let err = patch(
            &pool,
            user_id,
            id,
            json!({ "categoryId": theirs, "tagIds": [tag], "checked": true }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(row(&pool, id).await, (None, false, 0));

        let err = patch(&pool, stranger, id, json!({ "checked": true }))
            .await
            .unwrap_err();
        assert_eq!(err.0, StatusCode::NOT_FOUND);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_patch_on_a_paired_row_asks_first(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let out = seed_txn(&pool, account, "VIREMENT").await;
        let inn = seed_txn(&pool, account, "VIREMENT RECU").await;
        sqlx::query(
            "update transaction set transfer_pair_id = case id when $1 then $2 else $1 end \
             where id in ($1, $2)",
        )
        .bind(out)
        .bind(inn)
        .execute(&pool)
        .await
        .unwrap();
        let groceries = category(&pool, user_id, "groceries").await;

        let r = patch(&pool, user_id, out, json!({ "categoryId": groceries }))
            .await
            .unwrap();
        assert_eq!(r.pending_pair_breaks, Some(1));
        assert_eq!(row(&pool, out).await.0, None, "nothing written");

        let r = patch(
            &pool,
            user_id,
            out,
            json!({ "categoryId": groceries, "confirmBreakPairs": true }),
        )
        .await
        .unwrap();
        assert_eq!(r.pending_pair_breaks, None);
        assert_eq!(row(&pool, out).await.0, Some(groceries));
    }

    /// A bulk `filter` is the list's own query parameters: an absent
    /// `includeTransfers` hides transfers, `true` includes them.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_bulk_filter_includes_transfers_only_when_asked(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let spend = seed_txn(&pool, account, "LECLERC").await;
        let transfer = seed_txn(&pool, account, "VIREMENT").await;
        let internal = category(&pool, user_id, "internal_transfer").await;
        assign::set_category(&pool, user_id, transfer, Some(internal))
            .await
            .unwrap();

        let r = bulk(
            &pool,
            user_id,
            json!({ "filter": { "bucket": "out" }, "checked": true }),
        )
        .await
        .unwrap();
        assert_eq!(r.updated, 1);
        assert!(row(&pool, spend).await.1);
        assert!(!row(&pool, transfer).await.1, "hidden, so untouched");

        let r = bulk(
            &pool,
            user_id,
            json!({ "filter": { "bucket": "out", "includeTransfers": true }, "checked": true }),
        )
        .await
        .unwrap();
        assert_eq!(r.updated, 2);
        assert!(row(&pool, transfer).await.1);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_bulk_takes_ids_or_a_filter_not_both(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let id = seed_txn(&pool, account, "LECLERC").await;

        let err = bulk(
            &pool,
            user_id,
            json!({ "ids": [id], "filter": {}, "checked": true }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);

        let too_many: Vec<Uuid> = (0..=MAX_BULK_IDS).map(|_| Uuid::new_v4()).collect();
        let err = bulk(&pool, user_id, json!({ "ids": too_many, "checked": true }))
            .await
            .unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);

        let err = bulk(
            &pool,
            user_id,
            json!({ "filter": { "bucket": "sideways" }, "checked": true }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST, "unknown bucket");
        assert!(!row(&pool, id).await.1);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn deleting_a_category_is_404_409_or_204(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        let groceries = category(&pool, user_id, "groceries").await;
        let internal = category(&pool, user_id, "internal_transfer").await;

        let del = |who: Uuid, id: Uuid| {
            let pool = pool.clone();
            async move { delete_category(State(pool), auth(who), Path(id)).await }
        };
        assert_eq!(
            del(stranger, groceries).await.unwrap_err().0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            del(user_id, internal).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            del(user_id, groceries).await.unwrap(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            del(user_id, groceries).await.unwrap_err().0,
            StatusCode::NOT_FOUND
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_reorder_with_a_duplicate_id_is_refused(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        let groceries = category(&pool, user_id, "groceries").await.to_string();
        let err = reorder_categories(
            State(pool.clone()),
            auth(user_id),
            Json(ReorderBody {
                ids: vec![groceries.clone(), groceries],
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn a_twelve_month_mean_is_sent_to_the_cent() {
        assert_eq!(
            mean_to_string(Decimal::from(100) / Decimal::from(3)),
            "33.33"
        );
        assert_eq!(mean_to_string(Decimal::new(-5, 3)), "-0.01");
    }
}
