//! What the budget endpoints send and accept.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::error::ApiError;
use gripsou_core::budget::vocab::CategoryKind;
use gripsou_core::repo::budget::{assign, category, tag};

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "BudgetCategory")]
pub struct CategoryDto {
    pub id: String,
    pub name: String,
    /// Present only on a seeded row the user has not renamed; the frontend
    /// translates it and falls back to `name`.
    pub default_key: Option<String>,
    pub color: String,
    pub icon: Option<String>,
    pub hint: Option<String>,
    pub kind: CategoryKind,
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

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CategoryBody {
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub hint: Option<String>,
    pub kind: CategoryKind,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub archived: bool,
}

impl CategoryBody {
    pub fn validated(&self) -> Result<CategoryKind, ApiError> {
        if self.name.trim().is_empty() {
            return Err(ApiError::bad_request("invalid name or kind"));
        }
        Ok(self.kind)
    }
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReorderBody {
    /// Every category of the user, in the order they should appear.
    pub ids: Vec<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "BudgetTag")]
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

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TagBody {
    pub name: String,
    pub color: Option<String>,
}

/// The category fields a chip needs, and no more. Same shape the transactions
/// list already sends, so the frontend's `CategoryChip` is reused verbatim.
#[derive(Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "CategoryRef")]
pub struct CategoryRefDto {
    pub id: String,
    pub name: String,
    pub default_key: Option<String>,
    pub color: String,
    pub icon: Option<String>,
}

/// One discriminated union for the Sankey's nodes, the breakdown's rows and
/// the trend's series, so the chip has a single input shape everywhere.
#[derive(Serialize, Clone, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename = "Slice")]
pub enum SliceDto {
    Category { category: CategoryRefDto },
    Uncategorised,
    Other,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SliceAmount")]
pub struct SliceAmountDto {
    pub slice: SliceDto,
    /// Always a positive magnitude: the list it is in gives the direction.
    pub amount: String,
}

/// A headline figure and its two comparisons. Amounts, never percentages: the
/// frontend owns the formatting and the arrow/colour logic.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "Figure")]
pub struct FigureDto {
    pub amount: String,
    /// Absent, not null, under a custom range or with too little history.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prev_month: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avg12: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "BreakdownRow")]
pub struct BreakdownRowDto {
    pub slice: SliceDto,
    pub amount: String,
    pub txn_count: i64,
    /// Always absent on the `other` row, whose members change month to month.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avg12: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "Sankey")]
pub struct SankeyDto {
    pub sources: Vec<SliceAmountDto>,
    /// At most 8 entries plus `other`, which, when present, is always last.
    pub destinations: Vec<SliceAmountDto>,
    /// Neither appears in `sources`/`destinations`, and at a remainder of
    /// exactly zero neither is present: three states, not two.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub not_spent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub drawn_from_savings: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "Figures")]
pub struct FiguresDto {
    pub income: FigureDto,
    pub expenses: FigureDto,
    pub net: FigureDto,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "BudgetSummary")]
pub struct SummaryDto {
    /// Sum of `txn_count` across every `(day, category)` row in the period —
    /// NOT the count on the Transactions list header for the same month.
    /// Paired transfers, neutral rows and lot rows are all left out here; the
    /// list shows lots and neutral rows (internal transfers on request).
    pub txn_count: i64,
    /// Some row could not be valued: the figures are understated.
    pub fx_missing: bool,
    pub figures: FiguresDto,
    pub sankey: SankeyDto,
    /// Expense side only: expense-kind categories plus the uncategorised
    /// outflow row. The 7 largest plus one rolled-up `other`, whose members
    /// are not sent.
    pub breakdown: Vec<BreakdownRowDto>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct SummaryParams {
    pub month: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "TrendSeries")]
pub struct TrendSeriesDto {
    pub slice: SliceDto,
    pub values: Vec<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "BudgetTrend")]
pub struct TrendDto {
    /// `["2025-10", ..., "2026-09"]` — `months` entries ending at `anchor`.
    pub months: Vec<String>,
    /// One value per month in every series, zeros included.
    pub series: Vec<TrendSeriesDto>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct TrendParams {
    /// `"2026-09"`. Required: stepping back to March 2024 must compare against
    /// 2024, not against whenever the request happened to be made.
    pub anchor: String,
    pub months: Option<u32>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "TransactionPatch", optional_fields = nullable)]
pub struct PatchTransactionBody {
    /// Present and null clears the category; absent leaves it alone.
    #[serde(default, deserialize_with = "double_option")]
    #[ts(as = "Option<Uuid>")]
    pub category_id: Option<Option<Uuid>>,
    /// The row's whole tag set, replacing the one it has: there is no
    /// add/remove split.
    pub tag_ids: Option<Vec<Uuid>>,
    pub checked: Option<bool>,
    /// See `ApplyToDescriptionBody::confirm_break_pairs`: a category change
    /// on half of an internal transfer waits for it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub confirm_break_pairs: bool,
    /// Which rows `sameDescriptionCount` counts: the review queue sends
    /// `review`, so its offer matches the write it would launch.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub offer_scope: Scope,
}

/// Which of the rows sharing a description an "apply to all" reaches: every
/// one (the Transactions list), or only those still in review (the queue).
#[derive(Deserialize, Default, Clone, Copy, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SameDescriptionScope")]
pub enum Scope {
    #[default]
    All,
    Review,
}

/// Distinguishes `{"categoryId": null}` (clear it) from `{}` (leave it).
fn double_option<'de, D>(d: D) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(d).map(Some)
}

#[derive(Serialize, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PatchResult")]
pub struct PatchTransactionResponse {
    /// How many *other* transactions share this row's normalised description —
    /// what the "apply to all?" prompt offers. Present only when the category
    /// was written.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub same_description_count: Option<i64>,
    /// Same meaning as `UpdatedResponse::pending_pair_breaks`: non-null means
    /// nothing was written.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pending_pair_breaks: Option<i64>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct ApplyToDescriptionBody {
    pub category_id: Option<Uuid>,
    /// The caller has seen how many internal-transfer pairs this write would
    /// dissolve and wants it applied anyway. Without it, a write that would
    /// break one is refused (see `UpdatedResponse::pending_pair_breaks`).
    #[serde(default)]
    #[ts(optional = nullable)]
    pub confirm_break_pairs: bool,
    /// `review` from the queue: only rows still in review are written.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub scope: Scope,
}

#[derive(Serialize, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "WriteResult")]
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
    #[ts(optional)]
    pub pending_pair_breaks: Option<i64>,
    /// The rows written, for apply-to-description only: the review queue
    /// resolves those of its lines this swept up. A bulk write omits it.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ids: Option<Vec<Uuid>>,
}

impl UpdatedResponse {
    /// The answer to a write that did `(rows written, ids to report)`.
    pub fn answer(
        outcome: assign::WriteOutcome<(i64, Option<Vec<Uuid>>)>,
    ) -> Result<Self, ApiError> {
        match outcome {
            assign::WriteOutcome::Done((updated, ids)) => Ok(UpdatedResponse {
                updated,
                pending_pair_breaks: None,
                ids,
            }),
            assign::WriteOutcome::PendingPairBreaks(n) => Ok(UpdatedResponse {
                updated: 0,
                pending_pair_breaks: Some(n),
                ids: None,
            }),
            assign::WriteOutcome::Refused(r) => Err(r.into()),
        }
    }
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct BulkBody {
    /// Explicit rows, at most [`MAX_BULK_IDS`]. Exactly one of `ids` and
    /// `filter` is sent: `filter` targets every row the list shows under the
    /// same parameters — that is what "select all shown" means with 3.5 years
    /// behind an infinite scroll.
    pub ids: Option<Vec<Uuid>>,
    /// The list's own query parameters, decoded by the same
    /// `TransactionParams::filters`, so an absent `includeTransfers` hides transfers
    /// here exactly as it does in the list.
    pub filter: Option<crate::transactions::TransactionParams>,
    #[serde(default, deserialize_with = "double_option")]
    #[ts(as = "Option<Uuid>")]
    pub category_id: Option<Option<Uuid>>,
    pub add_tag_ids: Option<Vec<Uuid>>,
    pub checked: Option<bool>,
    /// See `ApplyToDescriptionBody::confirm_break_pairs`.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub confirm_break_pairs: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AcceptReviewResponse {
    /// How many *other* rows sharing this row's normalised description are
    /// still in review — what the review line's "apply to N others" offers.
    pub same_description_count: i64,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "AiLastRun")]
pub struct AiLastRunDto {
    pub outcome: gripsou_core::budget::vocab::AiRunOutcome,
    pub error: Option<String>,
    /// Identifies a completed run even when the browser missed it running.
    pub started_at: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "AiStatus")]
pub struct AiStatusDto {
    pub configured: bool,
    pub running: bool,
    pub remaining: i64,
    pub review_count: i64,
    pub last_run: Option<AiLastRunDto>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct UndoReviewReq {
    pub category_id: Option<uuid::Uuid>,
    #[ts(as = "Option<String>")]
    pub confidence: Option<Decimal>,
}
