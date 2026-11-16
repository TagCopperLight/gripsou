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
    /// Set only on a seeded row the user has not renamed; the frontend translates it, falling back to `name`.
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
    /// Not the count on the Transactions list header: paired transfers, neutral rows and lot rows are left out here.
    pub txn_count: i64,
    /// Some row could not be valued: the figures are understated.
    pub fx_missing: bool,
    pub figures: FiguresDto,
    pub sankey: SankeyDto,
    /// Expense side only: the 7 largest plus one rolled-up `other`, whose members are not sent.
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
    pub months: Vec<String>,
    /// One value per month in every series, zeros included.
    pub series: Vec<TrendSeriesDto>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct TrendParams {
    /// Required: stepping back to March 2024 must compare against 2024, not the request date.
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
    /// The whole tag set, replacing the current one.
    pub tag_ids: Option<Vec<Uuid>>,
    pub checked: Option<bool>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub confirm_break_pairs: bool,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub offer_scope: Scope,
}

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
    /// How many other transactions share this row's normalised description: what "apply to all?" offers. Present only when the category was written.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub same_description_count: Option<i64>,
    /// Non-null means nothing was written: the write would have dissolved this many internal-transfer pairs.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pending_pair_breaks: Option<i64>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct ApplyToDescriptionBody {
    pub category_id: Option<Uuid>,
    /// Confirms breaking the pairs a previous answer reported.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub confirm_break_pairs: bool,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub scope: Scope,
}

#[derive(Serialize, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "WriteResult")]
pub struct UpdatedResponse {
    pub updated: i64,
    /// Non-null means nothing was written: the write would have dissolved this many internal-transfer pairs and the caller has not confirmed.
    /// Resend the identical body with `confirmBreakPairs`. Distinct from `updated: 0`: a client that can't tell them apart swallows the confirmation step.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pending_pair_breaks: Option<i64>,
    /// The rows written, for apply-to-description only: the review queue resolves the lines this swept up.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ids: Option<Vec<Uuid>>,
}

impl UpdatedResponse {
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
    /// Exactly one of `ids` and `filter`. `filter` targets every row the list shows ("select all shown" over an infinite scroll).
    pub ids: Option<Vec<Uuid>>,
    /// The list's own query, decoded as the list decodes it.
    pub filter: Option<crate::transactions::TransactionParams>,
    #[serde(default, deserialize_with = "double_option")]
    #[ts(as = "Option<Uuid>")]
    pub category_id: Option<Option<Uuid>>,
    pub add_tag_ids: Option<Vec<Uuid>>,
    pub checked: Option<bool>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub confirm_break_pairs: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AcceptReviewResponse {
    /// Other rows sharing this row's description that are still in review: what "apply to N others" offers.
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
