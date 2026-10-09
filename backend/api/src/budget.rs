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

use crate::handlers::internal;
use chrono::NaiveDate;
use gripsou_core::budget::overview::{
    BASELINE_MONTHS, Baseline, BreakdownEntry, Figures, Month, Slice, baseline_figures,
    baseline_in, breakdown, by_month, figures, month_rows, sankey,
};
use std::collections::BTreeMap;

use gripsou_core::repo::budget::summary::{DayCategoryRow, day_category_totals};

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

    let refs = category_refs(&pool, user_id).await?;
    // By its seeded key, not its name: the user may rename it.
    let fold = refs
        .iter()
        .find(|r| r.default_key.as_deref() == Some("other_expense"))
        .and_then(|r| r.id.parse().ok());
    let (axis, series) = gripsou_core::budget::overview::trend(&rows, anchor, months, fold);

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
    /// Which rows `sameDescriptionCount` counts: the review queue sends
    /// `review`, so its offer matches the write it would launch.
    #[serde(default)]
    pub offer_scope: Scope,
}

/// Which of the rows sharing a description an "apply to all" reaches: every
/// one (the Transactions list), or only those still in review (the queue).
#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    #[default]
    All,
    Review,
}

/// Resolves `scope` against the reader's own review threshold.
async fn same_description(
    pool: &PgPool,
    user_id: Uuid,
    scope: Scope,
) -> Result<assign::SameDescription, (StatusCode, String)> {
    Ok(match scope {
        Scope::All => assign::SameDescription::All,
        Scope::Review => assign::SameDescription::NeedsReview(
            gripsou_core::repo::prefs::review_threshold(pool, user_id)
                .await
                .map_err(internal)?,
        ),
    })
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
        Some(_) => {
            let scope = same_description(&pool, user_id, b.offer_scope).await?;
            Some(
                assign::count_same_description(&pool, user_id, id, scope)
                    .await
                    .map_err(internal)?,
            )
        }
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
    /// `review` from the queue: only rows still in review are written.
    #[serde(default)]
    pub scope: Scope,
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
    let scope = same_description(&pool, user_id, b.scope).await?;
    match assign::apply_to_description(
        &pool,
        user_id,
        id,
        b.category_id,
        scope,
        b.confirm_break_pairs,
    )
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
            started_at: r.started_at.to_rfc3339(),
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
    /// How many *other* rows sharing this row's normalised description are
    /// still in review — what the review line's "apply to N others" offers.
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
    let scope = same_description(&pool, user_id, Scope::Review).await?;
    let same_description_count = assign::count_same_description(&pool, user_id, id, scope)
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

    // ── Helpers for the tests below ─────────────────────────────────────────

    /// A cash row at a fixed UTC date, so period tests do not depend on today.
    async fn seed_dated(
        pool: &PgPool,
        account_id: Uuid,
        day: &str,
        amount: i64,
        description: &str,
    ) -> Uuid {
        let kind = if amount < 0 { "withdrawal" } else { "deposit" };
        sqlx::query_scalar(
            "insert into transaction (account_id, ts, type, amount, description) \
             values ($1, ($2::date)::timestamp at time zone 'utc', $3, $4, $5) returning id",
        )
        .bind(account_id)
        .bind(day)
        .bind(kind)
        .bind(Decimal::from(amount))
        .bind(description)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Files `txn` as an unreviewed, low-confidence AI guess: a review-queue row.
    async fn ai_guess(pool: &PgPool, txn: Uuid, category_id: Uuid) {
        sqlx::query(
            "update transaction set budget_category_id = $2, category_source = 'ai', \
                    category_confidence = 0.1, category_reviewed_at = null \
              where id = $1",
        )
        .bind(txn)
        .bind(category_id)
        .execute(pool)
        .await
        .unwrap();
    }

    /// (category, source, reviewed) — the fields the review writes touch.
    async fn review_state(pool: &PgPool, txn: Uuid) -> (Option<Uuid>, Option<String>, bool) {
        sqlx::query_as(
            "select budget_category_id, category_source, category_reviewed_at is not null \
               from transaction where id = $1",
        )
        .bind(txn)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn category_body(name: &str, kind: &str) -> CategoryBody {
        serde_json::from_value(json!({ "name": name, "color": "#123456", "kind": kind })).unwrap()
    }

    fn tag_body(name: &str) -> TagBody {
        serde_json::from_value(json!({ "name": name, "color": null })).unwrap()
    }

    async fn new_category(
        pool: &PgPool,
        user_id: Uuid,
        name: &str,
        kind: &str,
    ) -> Result<CategoryDto, (StatusCode, String)> {
        create_category(
            State(pool.clone()),
            auth(user_id),
            Json(category_body(name, kind)),
        )
        .await
        .map(|(s, j)| {
            assert_eq!(s, StatusCode::CREATED);
            j.0
        })
    }

    async fn edit_category(
        pool: &PgPool,
        user_id: Uuid,
        id: Uuid,
        body: CategoryBody,
    ) -> Result<CategoryDto, (StatusCode, String)> {
        update_category(State(pool.clone()), auth(user_id), Path(id), Json(body))
            .await
            .map(|j| j.0)
    }

    async fn new_tag(
        pool: &PgPool,
        user_id: Uuid,
        name: &str,
    ) -> Result<TagDto, (StatusCode, String)> {
        create_tag(State(pool.clone()), auth(user_id), Json(tag_body(name)))
            .await
            .map(|(s, j)| {
                assert_eq!(s, StatusCode::CREATED);
                j.0
            })
    }

    async fn edit_tag(
        pool: &PgPool,
        user_id: Uuid,
        id: Uuid,
        name: &str,
    ) -> Result<TagDto, (StatusCode, String)> {
        update_tag(
            State(pool.clone()),
            auth(user_id),
            Path(id),
            Json(tag_body(name)),
        )
        .await
        .map(|j| j.0)
    }

    async fn category_names(pool: &PgPool, user_id: Uuid) -> Vec<String> {
        list_categories(State(pool.clone()), auth(user_id))
            .await
            .unwrap()
            .0
            .into_iter()
            .map(|c| c.name)
            .collect()
    }

    async fn tag_names(pool: &PgPool, user_id: Uuid) -> Vec<String> {
        list_tags(State(pool.clone()), auth(user_id))
            .await
            .unwrap()
            .0
            .into_iter()
            .map(|t| t.name)
            .collect()
    }

    async fn undo(
        pool: &PgPool,
        user_id: Uuid,
        txn: Uuid,
        body: serde_json::Value,
    ) -> Result<StatusCode, (StatusCode, String)> {
        undo_review(
            State(pool.clone()),
            auth(user_id),
            Path(txn),
            Json(serde_json::from_value(body).unwrap()),
        )
        .await
    }

    async fn summary_of(
        pool: &PgPool,
        user_id: Uuid,
        params: serde_json::Value,
    ) -> Result<SummaryDto, (StatusCode, String)> {
        summary(
            State(pool.clone()),
            auth(user_id),
            Query(serde_json::from_value(params).unwrap()),
        )
        .await
        .map(|j| j.0)
    }

    async fn trend_of(
        pool: &PgPool,
        user_id: Uuid,
        params: serde_json::Value,
    ) -> Result<TrendDto, (StatusCode, String)> {
        trend_handler(
            State(pool.clone()),
            auth(user_id),
            Query(serde_json::from_value(params).unwrap()),
        )
        .await
        .map(|j| j.0)
    }

    // ── Cross-user isolation ────────────────────────────────────────────────

    /// A category id is guessable from any shared link; the owner check is
    /// what stops another account renaming someone else's taxonomy.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_stranger_cannot_edit_someone_elses_category(pool: PgPool) {
        let (owner, _) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        let mine = new_category(&pool, owner, "Climbing", "expense")
            .await
            .unwrap();
        let id = Uuid::parse_str(&mine.id).unwrap();

        let err = edit_category(&pool, stranger, id, category_body("Hijacked", "income"))
            .await
            .err()
            .unwrap();
        assert_eq!(err.0, StatusCode::NOT_FOUND);
        assert!(
            category_names(&pool, owner)
                .await
                .contains(&"Climbing".into())
        );
    }

    /// Same owner check for tags: renaming is scoped to the caller.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_stranger_cannot_rename_someone_elses_tag(pool: PgPool) {
        let (owner, _) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        let id = Uuid::parse_str(&new_tag(&pool, owner, "Holiday").await.unwrap().id).unwrap();

        let err = edit_tag(&pool, stranger, id, "Hijacked")
            .await
            .err()
            .unwrap();
        assert_eq!(err.0, StatusCode::NOT_FOUND);
        assert_eq!(tag_names(&pool, owner).await, vec!["Holiday".to_string()]);
    }

    /// Deleting a tag strips it from every transaction, so a cross-user
    /// delete would silently erase another user's labelling.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_stranger_cannot_delete_someone_elses_tag(pool: PgPool) {
        let (owner, _) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        let id = Uuid::parse_str(&new_tag(&pool, owner, "Holiday").await.unwrap().id).unwrap();

        let err = delete_tag(State(pool.clone()), auth(stranger), Path(id))
            .await
            .err()
            .unwrap();
        assert_eq!(err.0, StatusCode::NOT_FOUND);
        assert_eq!(tag_names(&pool, owner).await, vec!["Holiday".to_string()]);
    }

    /// The category list is the caller's taxonomy only — another user's
    /// custom category must never show up in the picker.
    #[sqlx::test(migrations = "../migrations")]
    async fn the_category_list_holds_only_the_callers_own(pool: PgPool) {
        let (owner, _) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        new_category(&pool, owner, "Climbing", "expense")
            .await
            .unwrap();

        let theirs = list_categories(State(pool.clone()), auth(stranger))
            .await
            .unwrap()
            .0;
        assert!(!theirs.iter().any(|c| c.name == "Climbing"));
        let owned: Vec<Uuid> =
            sqlx::query_scalar("select id from budget_category where user_id = $1")
                .bind(stranger)
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            theirs.len(),
            owned.len(),
            "exactly the stranger's seeded rows"
        );
        assert!(
            theirs
                .iter()
                .all(|c| owned.contains(&Uuid::parse_str(&c.id).unwrap()))
        );
    }

    /// Same for tags.
    #[sqlx::test(migrations = "../migrations")]
    async fn the_tag_list_holds_only_the_callers_own(pool: PgPool) {
        let (owner, _) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        new_tag(&pool, owner, "Holiday").await.unwrap();
        new_tag(&pool, stranger, "Work").await.unwrap();

        assert_eq!(tag_names(&pool, stranger).await, vec!["Work".to_string()]);
        assert_eq!(tag_names(&pool, owner).await, vec!["Holiday".to_string()]);
    }

    /// Accepting marks the row reviewed; another user must not be able to
    /// do that to a row that is not theirs (404, not 409, so the endpoint
    /// does not even confirm the row exists).
    #[sqlx::test(migrations = "../migrations")]
    async fn a_stranger_cannot_accept_a_review_on_someone_elses_row(pool: PgPool) {
        let (owner, account) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        let txn = seed_txn(&pool, account, "LECLERC").await;
        let groceries = category(&pool, owner, "groceries").await;
        ai_guess(&pool, txn, groceries).await;

        let err = accept_review(State(pool.clone()), auth(stranger), Path(txn))
            .await
            .err()
            .unwrap();
        assert_eq!(err.0, StatusCode::NOT_FOUND);
        assert_eq!(
            review_state(&pool, txn).await,
            (Some(groceries), Some("ai".into()), false)
        );
    }

    /// Undo rewrites the row's category; another user must not reach it.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_stranger_cannot_undo_a_review_on_someone_elses_row(pool: PgPool) {
        let (owner, account) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        let txn = seed_txn(&pool, account, "LECLERC").await;
        let groceries = category(&pool, owner, "groceries").await;
        assign::set_category(&pool, owner, txn, Some(groceries))
            .await
            .unwrap();
        let before = review_state(&pool, txn).await;

        let err = undo(&pool, stranger, txn, json!({ "categoryId": null }))
            .await
            .status();
        assert_eq!(err, StatusCode::NOT_FOUND);
        assert_eq!(review_state(&pool, txn).await, before);
    }

    /// Undo can put a guess back only into one of the caller's own
    /// categories: otherwise a row could point at another user's taxonomy.
    #[sqlx::test(migrations = "../migrations")]
    async fn undo_into_a_strangers_category_is_refused(pool: PgPool) {
        let (owner, account) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        let txn = seed_txn(&pool, account, "LECLERC").await;
        let groceries = category(&pool, owner, "groceries").await;
        let theirs = category(&pool, stranger, "groceries").await;
        assign::set_category(&pool, owner, txn, Some(groceries))
            .await
            .unwrap();
        let before = review_state(&pool, txn).await;

        let status = undo(&pool, owner, txn, json!({ "categoryId": theirs }))
            .await
            .status();
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(review_state(&pool, txn).await, before);
    }

    /// "Apply to all with this description" on someone else's row is a 404.
    #[sqlx::test(migrations = "../migrations")]
    async fn apply_to_description_on_someone_elses_row_is_404(pool: PgPool) {
        let (_, account) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        let txn = seed_txn(&pool, account, "LECLERC").await;

        let err = apply_to_description(
            State(pool.clone()),
            auth(stranger),
            Path(txn),
            Json(serde_json::from_value(json!({ "categoryId": null })).unwrap()),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(err.0, StatusCode::NOT_FOUND);
    }

    /// Descriptions like "LECLERC" are shared by every user; "apply to all"
    /// must sweep only the caller's rows, or one user's categorising would
    /// rewrite everyone else's budget.
    #[sqlx::test(migrations = "../migrations")]
    async fn apply_to_description_sweeps_only_the_callers_rows(pool: PgPool) {
        let (_, owner_account) = seed_user(&pool).await;
        let (stranger, stranger_account) = seed_user(&pool).await;
        let owners = seed_txn(&pool, owner_account, "LECLERC").await;
        let theirs = seed_txn(&pool, stranger_account, "LECLERC").await;
        let their_other = seed_txn(&pool, stranger_account, "LECLERC").await;
        let groceries = category(&pool, stranger, "groceries").await;

        let r = apply_to_description(
            State(pool.clone()),
            auth(stranger),
            Path(theirs),
            Json(serde_json::from_value(json!({ "categoryId": groceries })).unwrap()),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(r.updated, 2);
        let mut ids = r.ids.unwrap();
        ids.sort();
        let mut want = vec![theirs, their_other];
        want.sort();
        assert_eq!(ids, want);
        assert_eq!(
            row(&pool, owners).await.0,
            None,
            "the owner's row untouched"
        );
    }

    // ── Validation and error mapping ────────────────────────────────────────

    /// Creating a category under an existing name is an ordinary UI mistake
    /// and must read as 409, not an opaque 500.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_duplicate_category_name_is_409(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        new_category(&pool, user_id, "Climbing", "expense")
            .await
            .unwrap();
        let err = new_category(&pool, user_id, "Climbing", "income")
            .await
            .err()
            .unwrap();
        assert_eq!(err.0, StatusCode::CONFLICT);
    }

    /// Renaming a category onto another's name is the same 409.
    #[sqlx::test(migrations = "../migrations")]
    async fn renaming_a_category_onto_an_existing_name_is_409(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        new_category(&pool, user_id, "Climbing", "expense")
            .await
            .unwrap();
        let other = new_category(&pool, user_id, "Diving", "expense")
            .await
            .unwrap();
        let err = edit_category(
            &pool,
            user_id,
            Uuid::parse_str(&other.id).unwrap(),
            category_body("Climbing", "expense"),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(err.0, StatusCode::CONFLICT);
    }

    /// Names are unique per user, not globally: a second user may reuse one.
    #[sqlx::test(migrations = "../migrations")]
    async fn two_users_may_share_a_category_name(pool: PgPool) {
        let (owner, _) = seed_user(&pool).await;
        let (stranger, _) = seed_user(&pool).await;
        new_category(&pool, owner, "Climbing", "expense")
            .await
            .unwrap();
        new_category(&pool, stranger, "Climbing", "expense")
            .await
            .unwrap();
    }

    /// Tags share the duplicate-name rule: 409 on create and on rename.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_duplicate_tag_name_is_409(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        new_tag(&pool, user_id, "Holiday").await.unwrap();
        let other = new_tag(&pool, user_id, "Work").await.unwrap();

        let err = new_tag(&pool, user_id, "Holiday").await.err().unwrap();
        assert_eq!(err.0, StatusCode::CONFLICT);
        let err = edit_tag(
            &pool,
            user_id,
            Uuid::parse_str(&other.id).unwrap(),
            "Holiday",
        )
        .await
        .err()
        .unwrap();
        assert_eq!(err.0, StatusCode::CONFLICT);
    }

    /// A blank name or a kind outside expense/income/neutral would create a
    /// category nothing can display or sum: 400, and nothing written.
    #[sqlx::test(migrations = "../migrations")]
    async fn creating_a_category_needs_a_name_and_a_known_kind(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        let before = category_names(&pool, user_id).await.len();
        for (name, kind) in [("   ", "expense"), ("Climbing", "savings")] {
            let err = new_category(&pool, user_id, name, kind)
                .await
                .err()
                .unwrap();
            assert_eq!(err.0, StatusCode::BAD_REQUEST, "{name:?}/{kind}");
        }
        assert_eq!(category_names(&pool, user_id).await.len(), before);
    }

    /// The same check guards an edit, so a rename cannot blank a category.
    #[sqlx::test(migrations = "../migrations")]
    async fn editing_a_category_needs_a_name_and_a_known_kind(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        let groceries = category(&pool, user_id, "groceries").await;
        for (name, kind) in [("", "expense"), ("Food", "savings")] {
            let err = edit_category(&pool, user_id, groceries, category_body(name, kind))
                .await
                .err()
                .unwrap();
            assert_eq!(err.0, StatusCode::BAD_REQUEST, "{name:?}/{kind}");
        }
    }

    /// A tag needs a name, on create and on rename.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_tag_needs_a_name(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        let err = new_tag(&pool, user_id, "  ").await.err().unwrap();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        let id = Uuid::parse_str(&new_tag(&pool, user_id, "Holiday").await.unwrap().id).unwrap();
        let err = edit_tag(&pool, user_id, id, "").await.err().unwrap();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert_eq!(tag_names(&pool, user_id).await, vec!["Holiday".to_string()]);
    }

    /// The summary period is a month or a from/to pair, never ambiguous:
    /// every other shape is a 400 rather than a silently guessed period.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_summary_period_must_be_one_month_or_an_ordered_range(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        for params in [
            json!({}),
            json!({ "month": "2026-13" }),
            json!({ "month": "September" }),
            json!({ "from": "2026-03-01" }),
            json!({ "from": "2026-03-31", "to": "2026-03-01" }),
            json!({ "month": "2026-03", "from": "2026-03-01", "to": "2026-03-31" }),
        ] {
            let err = summary_of(&pool, user_id, params.clone())
                .await
                .err()
                .unwrap_or_else(|| panic!("{params} was accepted"));
            assert_eq!(err.0, StatusCode::BAD_REQUEST, "{params}");
        }
    }

    /// The trend needs a parseable anchor and a 1..=24 month window.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_trend_needs_a_valid_anchor_and_window(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        for params in [
            json!({ "anchor": "2026-13" }),
            json!({ "anchor": "2026-03", "months": 0 }),
            json!({ "anchor": "2026-03", "months": 25 }),
        ] {
            let err = trend_of(&pool, user_id, params.clone())
                .await
                .err()
                .unwrap_or_else(|| panic!("{params} was accepted"));
            assert_eq!(err.0, StatusCode::BAD_REQUEST, "{params}");
        }
        assert!(
            trend_of(&pool, user_id, json!({ "anchor": "2026-03", "months": 24 }))
                .await
                .is_ok()
        );
    }

    /// The handler is the only range check on an undo's confidence: the
    /// repository stores whatever it gets.
    #[sqlx::test(migrations = "../migrations")]
    async fn an_undo_confidence_outside_0_to_1_is_400(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let txn = seed_txn(&pool, account, "LECLERC").await;
        let groceries = category(&pool, user_id, "groceries").await;
        assign::set_category(&pool, user_id, txn, Some(groceries))
            .await
            .unwrap();
        let before = review_state(&pool, txn).await;
        for c in ["-0.01", "1.01"] {
            let status = undo(
                &pool,
                user_id,
                txn,
                json!({ "categoryId": groceries, "confidence": c }),
            )
            .await
            .status();
            assert_eq!(status, StatusCode::BAD_REQUEST, "{c}");
        }
        assert_eq!(review_state(&pool, txn).await, before);
    }

    /// Accepting a row that is not an unreviewed AI guess is 409: the row is
    /// the caller's, but the action does not apply to it.
    #[sqlx::test(migrations = "../migrations")]
    async fn accepting_a_row_not_in_review_is_409(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let txn = seed_txn(&pool, account, "LECLERC").await;
        let err = accept_review(State(pool.clone()), auth(user_id), Path(txn))
            .await
            .err()
            .unwrap();
        assert_eq!(err.0, StatusCode::CONFLICT);
    }

    // ── Wiring ──────────────────────────────────────────────────────────────

    /// A tag created through the API is listed, renamed and deleted through
    /// it, and a second delete is a 404.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_tag_round_trips_create_list_rename_delete(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        let created = new_tag(&pool, user_id, "  Holiday  ").await.unwrap();
        assert_eq!(created.name, "Holiday", "trimmed");
        assert_eq!(created.tx_count, 0);
        let id = Uuid::parse_str(&created.id).unwrap();
        assert_eq!(tag_names(&pool, user_id).await, vec!["Holiday".to_string()]);

        let renamed = edit_tag(&pool, user_id, id, "Trip").await.unwrap();
        assert_eq!(
            (renamed.id.as_str(), renamed.name.as_str()),
            (created.id.as_str(), "Trip")
        );
        assert_eq!(tag_names(&pool, user_id).await, vec!["Trip".to_string()]);

        let del =
            |pool: PgPool| async move { delete_tag(State(pool), auth(user_id), Path(id)).await };
        assert_eq!(del(pool.clone()).await.unwrap(), StatusCode::NO_CONTENT);
        assert!(tag_names(&pool, user_id).await.is_empty());
        assert_eq!(
            del(pool.clone()).await.err().unwrap().0,
            StatusCode::NOT_FOUND
        );
    }

    /// A category created through the API is listed, edited (name, kind,
    /// archived) and deleted through it.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_category_round_trips_create_list_edit_delete(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        let created = new_category(&pool, user_id, " Climbing ", "expense")
            .await
            .unwrap();
        assert_eq!(
            (
                created.name.as_str(),
                created.kind.as_str(),
                created.archived
            ),
            ("Climbing", "expense", false)
        );
        let id = Uuid::parse_str(&created.id).unwrap();
        assert!(
            category_names(&pool, user_id)
                .await
                .contains(&"Climbing".into())
        );

        let mut body = category_body("Bouldering", "neutral");
        body.archived = true;
        let edited = edit_category(&pool, user_id, id, body).await.unwrap();
        assert_eq!(
            (edited.name.as_str(), edited.kind.as_str(), edited.archived),
            ("Bouldering", "neutral", true)
        );
        let listed = list_categories(State(pool.clone()), auth(user_id))
            .await
            .unwrap()
            .0;
        let row = listed.iter().find(|c| c.id == created.id).unwrap();
        assert_eq!((row.name.as_str(), row.archived), ("Bouldering", true));

        assert_eq!(
            delete_category(State(pool.clone()), auth(user_id), Path(id))
                .await
                .unwrap(),
            StatusCode::NO_CONTENT
        );
        assert!(
            !category_names(&pool, user_id)
                .await
                .contains(&"Bouldering".into())
        );
    }

    /// Accept then undo is the review queue's "oops": the row must go back
    /// exactly into the queue with the guess the client showed.
    #[sqlx::test(migrations = "../migrations")]
    async fn undo_after_accept_puts_the_row_back_in_review(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let txn = seed_txn(&pool, account, "LECLERC").await;
        seed_txn(&pool, account, "LECLERC").await;
        let groceries = category(&pool, user_id, "groceries").await;
        ai_guess(&pool, txn, groceries).await;
        let threshold = gripsou_core::repo::prefs::review_threshold(&pool, user_id)
            .await
            .unwrap();
        assert_eq!(
            review::review_count(&pool, user_id, threshold)
                .await
                .unwrap(),
            1
        );

        let r = accept_review(State(pool.clone()), auth(user_id), Path(txn))
            .await
            .unwrap()
            .0;
        assert_eq!(r.same_description_count, 0, "the twin is not in review");
        assert_eq!(
            review_state(&pool, txn).await,
            (Some(groceries), Some("ai".into()), true)
        );
        assert_eq!(
            review::review_count(&pool, user_id, threshold)
                .await
                .unwrap(),
            0
        );

        let status = undo(
            &pool,
            user_id,
            txn,
            json!({ "categoryId": groceries, "confidence": "0.1" }),
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(
            review_state(&pool, txn).await,
            (Some(groceries), Some("ai".into()), false)
        );
        assert_eq!(
            review::review_count(&pool, user_id, threshold)
                .await
                .unwrap(),
            1
        );
    }

    /// The summary endpoint wires the period through to the figures: one
    /// salary and two purchases in March, one purchase outside it.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_month_summary_totals_its_own_rows(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        seed_dated(&pool, account, "2026-03-01", 2000, "SALAIRE").await;
        seed_dated(&pool, account, "2026-03-10", -30, "LECLERC").await;
        seed_dated(&pool, account, "2026-03-31", -20, "LECLERC").await;
        seed_dated(&pool, account, "2026-04-01", -500, "LECLERC").await;

        let s = summary_of(&pool, user_id, json!({ "month": "2026-03" }))
            .await
            .unwrap();
        assert_eq!(s.txn_count, 3);
        assert_eq!(
            s.figures.income.amount.parse::<Decimal>().unwrap(),
            Decimal::from(2000)
        );
        assert_eq!(
            s.figures.expenses.amount.parse::<Decimal>().unwrap(),
            Decimal::from(50)
        );
        assert_eq!(
            s.figures.net.amount.parse::<Decimal>().unwrap(),
            Decimal::from(1950)
        );
        assert!(
            s.figures.income.prev_month.is_none(),
            "no history behind it"
        );

        let r = summary_of(
            &pool,
            user_id,
            json!({ "from": "2026-03-31", "to": "2026-04-01" }),
        )
        .await
        .unwrap();
        assert_eq!(r.txn_count, 2);
        assert_eq!(
            r.figures.expenses.amount.parse::<Decimal>().unwrap(),
            Decimal::from(520)
        );
    }

    /// The trend endpoint returns `months` labels ending at the anchor and
    /// puts each month's spending in its own column.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_trend_puts_spending_in_its_month(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let groceries = category(&pool, user_id, "groceries").await;
        for (day, amount) in [("2026-02-10", -40), ("2026-03-10", -30)] {
            let t = seed_dated(&pool, account, day, amount, "LECLERC").await;
            assign::set_category(&pool, user_id, t, Some(groceries))
                .await
                .unwrap();
        }

        let t = trend_of(&pool, user_id, json!({ "anchor": "2026-03", "months": 3 }))
            .await
            .unwrap();
        assert_eq!(t.months, vec!["2026-01", "2026-02", "2026-03"]);
        let series = t
            .series
            .iter()
            .find(|s| matches!(&s.slice, SliceDto::Category { category } if category.id == groceries.to_string()))
            .expect("a groceries series");
        let values: Vec<Decimal> = series.values.iter().map(|v| v.parse().unwrap()).collect();
        assert_eq!(
            values,
            vec![Decimal::ZERO, Decimal::from(40), Decimal::from(30)]
        );
    }

    /// The seeded "Other" category is rolled into the trend's own Other
    /// series, so the legend never shows two slices called Other.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_trend_folds_the_other_category_into_other(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let other = category(&pool, user_id, "other_expense").await;
        let t = seed_dated(&pool, account, "2026-03-10", -25, "MISC").await;
        assign::set_category(&pool, user_id, t, Some(other))
            .await
            .unwrap();

        let t = trend_of(&pool, user_id, json!({ "anchor": "2026-03", "months": 3 }))
            .await
            .unwrap();
        assert_eq!(t.series.len(), 1);
        assert!(matches!(t.series[0].slice, SliceDto::Other));
        let values: Vec<Decimal> = t.series[0]
            .values
            .iter()
            .map(|v| v.parse().unwrap())
            .collect();
        assert_eq!(
            values,
            vec![Decimal::ZERO, Decimal::ZERO, Decimal::from(25)]
        );
    }

    /// The count endpoint reads the list's own filters: total, uncategorised
    /// and the matching sum agree with the seeded rows.
    #[sqlx::test(migrations = "../migrations")]
    async fn the_transaction_counts_match_the_seeded_rows(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let (_, stranger_account) = seed_user(&pool).await;
        let a = seed_dated(&pool, account, "2026-03-10", -30, "LECLERC").await;
        seed_dated(&pool, account, "2026-03-11", -20, "FNAC").await;
        seed_dated(&pool, stranger_account, "2026-03-11", -999, "FNAC").await;
        let groceries = category(&pool, user_id, "groceries").await;
        assign::set_category(&pool, user_id, a, Some(groceries))
            .await
            .unwrap();

        let counts = |params: serde_json::Value| {
            let pool = pool.clone();
            async move {
                transaction_count_summary(
                    State(pool),
                    auth(user_id),
                    Query(serde_json::from_value(params).unwrap()),
                )
                .await
                .map(|j| j.0)
            }
        };
        let c = counts(json!({})).await.unwrap();
        assert_eq!((c.matching, c.total, c.uncategorized), (2, 2, 1));
        assert_eq!(
            c.matching_total.parse::<Decimal>().unwrap(),
            Decimal::from(-50)
        );

        let c = counts(json!({ "search": "fnac" })).await.unwrap();
        assert_eq!((c.matching, c.total), (1, 2));
        assert_eq!(
            c.matching_total.parse::<Decimal>().unwrap(),
            Decimal::from(-20)
        );

        let err = counts(json!({ "bucket": "sideways" })).await.err().unwrap();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    /// With no AI provider configured (the default settings), the status
    /// says so and still reports the user's review queue.
    #[sqlx::test(migrations = "../migrations")]
    async fn the_ai_status_says_not_configured_by_default(pool: PgPool) {
        let (user_id, account) = seed_user(&pool).await;
        let txn = seed_txn(&pool, account, "LECLERC").await;
        ai_guess(&pool, txn, category(&pool, user_id, "groceries").await).await;

        let s = categorize_status(State(pool.clone()), auth(user_id))
            .await
            .unwrap()
            .0;
        assert!(!s.configured);
        assert!(!s.running);
        assert_eq!(s.review_count, 1);
        assert!(s.last_run.is_none());
    }

    /// Asking for a run with no AI configured is refused with 409, never
    /// queued — nothing could ever pick it up.
    #[sqlx::test(migrations = "../migrations")]
    async fn requesting_a_run_without_an_ai_is_409(pool: PgPool) {
        let (user_id, _) = seed_user(&pool).await;
        assert_eq!(
            request_categorize(State(pool.clone()), auth(user_id)).await,
            StatusCode::CONFLICT
        );
    }

    /// `undo_review` answers `Ok(status)` for a refusal decided by the
    /// repository and `Err` for one decided by the handler; the tests only
    /// care about the status.
    trait StatusOf {
        fn status(self) -> StatusCode;
    }

    impl StatusOf for Result<StatusCode, (StatusCode, String)> {
        fn status(self) -> StatusCode {
            match self {
                Ok(s) => s,
                Err((s, _)) => s,
            }
        }
    }
}
