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

use chrono::NaiveDate;
use gripsou_core::budget::overview::{
    BASELINE_MONTHS, Baseline, BreakdownEntry, Figures, Month, Slice, baseline, baseline_figures,
    breakdown, figures, rows_in, sankey,
};

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
    pub kind: String,
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
    pub saved: FigureDto,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryDto {
    pub currency: String,
    /// Sum of `txn_count` across every `(day, category)` row in the period —
    /// NOT the count on the Transactions list header for the same month.
    /// The two differ in both directions: this includes `internal`-kind rows
    /// (paired transfers), which the list hides by default, and excludes lot
    /// rows (purchases/sales), which the list includes. Both are correct for
    /// what they each report; they are simply not counting the same set.
    pub txn_count: i64,
    pub fx_missing: bool,
    /// Nothing is missing from these figures — the whole sum is in the
    /// pivot currency, because the reader's reporting currency had no rate.
    pub reporting_fx_missing: bool,
    /// True exactly when the period was given as a month. A custom range's
    /// comparisons are month-shaped and meaningless, so the frontend hides
    /// those cells rather than rendering an absent value as a dash.
    pub comparable: bool,
    pub figures: FiguresDto,
    pub sankey: SankeyDto,
    pub breakdown: Vec<BreakdownRowDto>,
    /// So SHARE is arithmetic the frontend does, not a second server opinion
    /// that can round differently from the column beside it.
    pub expenses_total: String,
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
    let rows = category::list_categories(pool, user_id)
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
            kind: r.kind,
        })
        .collect())
}

fn figure(amount: Decimal, prev: Option<Decimal>, avg: Option<Decimal>) -> FigureDto {
    FigureDto {
        amount: amount.to_string(),
        prev_month: prev.map(|d| d.to_string()),
        avg12: avg.map(|d| d.to_string()),
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

    let period: Vec<DayCategoryRow> = rows_in(&all, from, to).into_iter().cloned().collect();
    let f = figures(&period);
    let refs = category_refs(&pool, user_id).await?;

    // Comparisons exist only for a month period with enough history behind it.
    let base: Option<Baseline> = month.and_then(|m| baseline(&all, m));
    let base_f: Option<Figures> = base.as_ref().map(baseline_figures);
    let prev_f: Option<Figures> = month.filter(|_| base.is_some()).map(|m| {
        let (pf, pt) = m.prev().bounds();
        let prev: Vec<DayCategoryRow> = rows_in(&all, pf, pt).into_iter().cloned().collect();
        figures(&prev)
    });

    // `sankey()` computes `figures(rows)` internally for the balancing
    // remainder — it takes only the rows, never a caller-supplied total.
    let s = sankey(&period);
    let rows = breakdown(&period, base.as_ref());

    Ok(Json(SummaryDto {
        currency: gripsou_core::repo::prefs::reporting_currency(&pool, user_id)
            .await
            .map_err(internal)?,
        txn_count: period.iter().map(|r| r.txn_count).sum(),
        fx_missing: period.iter().any(|r| r.fx_missing),
        reporting_fx_missing: period.iter().any(|r| r.reporting_fx_missing),
        comparable: month.is_some(),
        figures: FiguresDto {
            income: figure(f.income, prev_f.map(|x| x.income), base_f.map(|x| x.income)),
            expenses: figure(
                f.expenses,
                prev_f.map(|x| x.expenses),
                base_f.map(|x| x.expenses),
            ),
            net: figure(f.net, prev_f.map(|x| x.net), base_f.map(|x| x.net)),
            saved: figure(f.saved, prev_f.map(|x| x.saved), base_f.map(|x| x.saved)),
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
                avg12: e.avg12.map(|d| d.to_string()),
            })
            .collect(),
        expenses_total: f.expenses.to_string(),
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
/// even though both happen to be 12 today: spec §4.4 draws the chart and the
/// baseline as different windows on purpose — the chart's default bars end
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
    /// The caller has seen how many internal-transfer pairs this write would
    /// dissolve and wants it applied anyway. Without it, a write that would
    /// break one is refused (see `UpdatedResponse::pending_pair_breaks`).
    #[serde(default)]
    pub confirm_break_pairs: bool,
}

#[derive(Serialize)]
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
}

pub async fn apply_to_description(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<ApplyToDescriptionBody>,
) -> Result<Json<UpdatedResponse>, (StatusCode, String)> {
    if !b.confirm_break_pairs {
        let breaks = assign::count_paired_same_description(&pool, user_id, id)
            .await
            .map_err(internal)?;
        if breaks > 0 {
            return Ok(Json(UpdatedResponse {
                updated: 0,
                pending_pair_breaks: Some(breaks),
            }));
        }
    }
    let updated = assign::apply_category_to_same_description(&pool, user_id, id, b.category_id)
        .await
        .map_err(internal)?;
    Ok(Json(UpdatedResponse {
        updated: updated as i64,
        pending_pair_breaks: None,
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
    /// See `ApplyToDescriptionBody::confirm_break_pairs`.
    #[serde(default)]
    pub confirm_break_pairs: bool,
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
    .await
    .map_err(internal)?;
    Ok(Json(UpdatedResponse {
        updated: outcome.updated as i64,
        pending_pair_breaks: outcome.pending_pair_breaks,
    }))
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
    let filters = crate::handlers::filters_from_params(p)?;
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
