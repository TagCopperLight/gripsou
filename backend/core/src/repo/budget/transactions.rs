//! The Transactions page: its rows, header counts and "select all shown"
//! ids, all through the `budget_transaction_matches` SQL function, so the
//! three cannot disagree about which rows a filter admits.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::budget::vocab::{CategoryKind, CategorySource, RowSource};
use crate::error::CoreError;

/// Calls a sqlx query macro with `budget_transaction_matches`' twelve
/// arguments as `$1`..`$12`, in the function's order, then `$extra` from `$13`.
macro_rules! with_filter_args {
    ($macro:ident!($($head:tt)*), $user_id:expr, $f:expr $(, $extra:expr)* $(,)?) => {
        sqlx::$macro!(
            $($head)*,
            $user_id,
            $f.review_threshold,
            $f.search,
            $f.account_id,
            $f.from,
            $f.to,
            $f.bucket.as_str(),
            &$f.category_ids,
            &$f.tag_ids,
            $f.uncategorized,
            $f.needs_review,
            $f.include_transfers
            $(, $extra)*
        )
    };
}

pub struct TransactionListRow {
    pub id: Uuid,
    pub day: NaiveDate,
    pub kind: String,
    pub description: Option<String>,
    /// In `account_currency` — the amount domain, as the provider sent it. Not
    /// converted: the list shows what actually moved in the account.
    pub amount: Decimal,
    /// The same movement in the reader's currency at the transaction's own
    /// date. The list renders `amount`; this exists so an explicit multi-row
    /// selection can be totalled without a round trip.
    /// `None` when the account's or the reader's currency has no rate that day.
    pub amount_reporting: Option<Decimal>,
    /// Structured, not a pre-built sentence: the frontend's i18n and
    /// per-user number formatting render the lot fields.
    pub source: RowSource,
    pub ticker: Option<String>,
    /// What a lot row's logo is built from (`Logos::instrument` in `providers`);
    /// null on a cash row.
    pub instrument_kind: Option<String>,
    pub instrument_isin: Option<String>,
    pub instrument_symbol: Option<String>,
    pub quantity: Option<Decimal>,
    pub unit_price: Option<Decimal>,
    pub fee: Option<Decimal>,
    pub account_id: Uuid,
    pub account_name: String,
    pub account_color: String,
    /// Also the currency of a lot row's `amount`: lot prices are recorded in
    /// the account's currency, as `lot_basis` and the holdings table assume.
    pub account_currency: String,

    // ── Budget ──────────────────────────────────────────────────────────────
    // All null/false on a lot row: a purchase is an investment record, not a
    // budget item.
    pub category_id: Option<Uuid>,
    pub category_name: Option<String>,
    pub category_default_key: Option<String>,
    pub category_color: Option<String>,
    pub category_icon: Option<String>,
    pub category_kind: Option<CategoryKind>,
    pub category_source: Option<CategorySource>,
    pub category_confidence: Option<Decimal>,
    /// Derived, never stored: an unreviewed AI guess that is under the reader's threshold, has no category, or sits in an internal/excluded category.
    pub needs_review: bool,
    pub checked: bool,
    /// The row is one half of an auto-paired internal transfer.
    pub is_transfer: bool,
    /// The pairing pass categorised this row, but its link is gone — a user
    /// corrected the other half, so this one still reads as an
    /// internal transfer while netting against nothing.
    ///
    /// Keyed on `category_source = 'pair'` rather than on the category itself:
    /// only the pairing pass writes that source, and it always writes a link,
    /// so a missing link means one was removed. A cross-currency transfer the
    /// user categorised by hand never had a link (pairing matches
    /// one currency only) and must not be
    /// flagged forever.
    pub is_orphan_transfer: bool,
}

crate::text_enum::text_enum! {
    /// The TYPE control on the filter panel: one value, always one selected.
    /// Spelled as the API query parameter and the SQL function spell it.
    #[derive(Default)]
    pub enum TypeBucket {
        #[default]
        All = "all",
        MoneyIn = "in",
        MoneyOut = "out",
        Lots = "lots",
    }
}

#[derive(Debug, Clone)]
pub struct TransactionFilters {
    /// Case-insensitive substring of `description` (cash rows) or `ticker`
    /// (lot rows).
    pub search: Option<String>,
    pub account_id: Option<Uuid>,
    pub bucket: TypeBucket,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    /// Empty means no filter. Several categories mean *either* of them.
    pub category_ids: Vec<Uuid>,
    /// Empty means no filter. Several tags mean *all* of them.
    pub tag_ids: Vec<Uuid>,
    pub uncategorized: bool,
    pub needs_review: bool,
    /// Internal transfers (the `internal_transfer` system category) are hidden
    /// unless this is set: they are money moving between the user's own
    /// accounts, noise in a list about spending. The OTHERS panel's
    /// "Internal transfers" toggle is the only thing that turns them back on,
    /// and when it does they are filtered like any other row.
    pub include_transfers: bool,
    /// Below this, an AI guess is in the review queue. A parameter rather than
    /// a constant so moving it reshapes the queue instantly.
    pub review_threshold: Decimal,
    pub limit: i64,
    pub offset: i64,
}

/// Everything, unfiltered — the base a caller mutates.
impl Default for TransactionFilters {
    fn default() -> Self {
        Self {
            search: None,
            account_id: None,
            bucket: TypeBucket::All,
            from: None,
            to: None,
            category_ids: vec![],
            tag_ids: vec![],
            uncategorized: false,
            needs_review: false,
            include_transfers: true,
            review_threshold: crate::repo::prefs::threshold_fraction(
                crate::repo::prefs::DEFAULT_BUDGET_AI_THRESHOLD,
            ),
            limit: 200,
            offset: 0,
        }
    }
}

/// One page of the list. Every filter is optional inside
/// `budget_transaction_matches`, so one prepared statement covers all
/// combinations and the macro still checks this query at compile time.
pub async fn transactions(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    f: &TransactionFilters,
) -> Result<Vec<TransactionListRow>, CoreError> {
    let rows = with_filter_args!(
        query_as!(
            TransactionListRow,
            r#"
        -- The filter/sort/page cut happens before any conversion, so the grid
        -- holds only the days this page needs.
        with filtered as (
            select *
            from budget_transaction_matches($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            order by day desc, id
            limit $13 offset $14
        ),
        grid as materialized (
            select as_of, currency, rate
            from fx_grid(array(select distinct day from filtered))
        ),
        reporting as (
            select (select currency from users where id = $1) as code
        )
        select id as "id!", day as "day!", kind as "kind!", description, amount as "amount!",
               fx_convert(filtered.amount, afx.rate, rfx.rate) as "amount_reporting?",
               source as "source!: RowSource", ticker, instrument_kind, instrument_isin,
               instrument_symbol, quantity, unit_price, fee,
               account_id as "account_id!", account_name as "account_name!",
               account_color as "account_color!", account_currency as "account_currency!",
               filtered.category_id, category_name, category_default_key, category_color,
               category_icon, category_kind as "category_kind: CategoryKind",
               category_source as "category_source: CategorySource", category_confidence,
               needs_review as "needs_review!", checked as "checked!",
               is_transfer as "is_transfer!",
               is_orphan_transfer as "is_orphan_transfer!"
        from filtered
        left join grid afx on afx.as_of = filtered.day
                          and afx.currency = filtered.account_currency
        left join grid rfx on rfx.as_of = filtered.day
                          and rfx.currency = (select code from reporting)
        order by day desc, id
        "#
        ),
        user_id,
        f,
        f.limit,
        f.offset,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, Clone)]
pub struct TagRef {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
}

/// Tags for a page of transactions, in one round trip. Untagged rows are absent
/// from the map rather than present with an empty vector.
///
/// Ordered exactly like the catalog `list_tags` returns (oldest tag first),
/// not by name: the row and the tag chooser then read in the same order, and
/// assigning a tag never makes an existing one jump. Where a row's tags
/// overflow its cell the frontend drops the tail, so "oldest first" also
/// decides which ones survive.
pub async fn tags_for_transactions(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    ids: &[Uuid],
) -> Result<std::collections::HashMap<Uuid, Vec<TagRef>>, CoreError> {
    let rows = sqlx::query!(
        r#"
        select tt.transaction_id as "transaction_id!",
               g.id   as "id!",
               g.name as "name!",
               g.color
        from budget_transaction_tag tt
        join budget_tag g on g.id = tt.tag_id
        where tt.transaction_id = any($1)
          and g.user_id = $2
        order by g.created_at, g.name, g.id
        "#,
        ids,
        user_id,
    )
    .fetch_all(pool)
    .await?;

    let mut map: std::collections::HashMap<Uuid, Vec<TagRef>> = std::collections::HashMap::new();
    for r in rows {
        map.entry(r.transaction_id).or_default().push(TagRef {
            id: r.id,
            name: r.name,
            color: r.color,
        });
    }
    Ok(map)
}

#[derive(Debug, Clone, Copy)]
pub struct TransactionCounts {
    /// Rows under the active filters — the left half of "matching / total".
    pub matching: i64,
    /// Every cash and lot row this user has, filters ignored.
    pub total: i64,
    /// Cash rows with no category, filters ignored — the list header's second
    /// number, and the one that starts out enormous.
    pub uncategorized: i64,
    /// The cash rows among `matching`: what "select all shown" selects, the
    /// same rows as `matching_transaction_ids`. Lot rows carry no budget.
    pub selectable: i64,
    /// The selection bar's figure: the `selectable` rows summed in the
    /// reader's reporting currency, each converted at its own date.
    pub matching_total: Decimal,
    /// At least one selectable row had no rate on its day, for its account's
    /// currency or the reader's, so it is left out of `matching_total`.
    /// Mirrors `SummaryDto.fxMissing` — same convention, same meaning.
    pub fx_missing: bool,
}

/// The list header. `matching` reads the same `budget_transaction_matches` as
/// `transactions()`, so it counts exactly the rows the list pages through —
/// under `bucket: All` that includes lot rows, unlike
/// `matching_transaction_ids`, which keeps only the cash ones (`selectable`,
/// and the total, follow that one).
pub async fn transaction_counts(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    f: &TransactionFilters,
) -> Result<TransactionCounts, CoreError> {
    let row = with_filter_args!(
        query!(
            r#"
        with matching as (
            select source, amount, account_currency, day
            from budget_transaction_matches($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ),
        reporting as (
            select (select currency from users where id = $1) as code
        ),
        -- One FX row per needed day and account currency, with both legs.
        -- Keeping reporting FX on the same row avoids a separate join whose
        -- generic plan estimates one reporting row and repeatedly scans the
        -- entire date grid for every matching transaction.
        fx as materialized (
            select day, account_currency,
                   fx_asof(account_currency, day) as account_rate,
                   fx_asof((select code from reporting), day) as reporting_rate
            from (select distinct day, account_currency from matching) needed
        ),
        converted as (
            select m.source, fx_convert(m.amount, fx.account_rate, fx.reporting_rate) as amount
            from matching m
            left join fx on fx.day = m.day and fx.account_currency = m.account_currency
        ),
        totals as (
            select count(*) as n,
                   count(*) filter (where source = 'cash') as selectable,
                   coalesce(sum(amount) filter (where source = 'cash'), 0) as total,
                   coalesce(bool_or(amount is null) filter (where source = 'cash'), false)
                       as fx_missing
            from converted
        ),
        everything as (
            select count(*) as n,
                   count(*) filter (where source = 'cash' and category_id is null)
                       as uncategorized
            from budget_transaction_rows($1, $2)
        )
        select t.n as "matching!", t.selectable as "selectable!", t.total as "matching_total!",
               t.fx_missing as "fx_missing!",
               e.n as "total!", e.uncategorized as "uncategorized!"
        from totals t, everything e
        "#
        ),
        user_id,
        f,
    )
    .fetch_one(pool)
    .await?;

    Ok(TransactionCounts {
        matching: row.matching,
        total: row.total,
        uncategorized: row.uncategorized,
        selectable: row.selectable,
        matching_total: row.matching_total,
        fx_missing: row.fx_missing,
    })
}

/// Ids of the **cash** transactions matching the filters — what "select all
/// shown" means, and what every bulk action runs against. Same filter as the
/// list; lot rows are dropped because they carry no budget.
pub async fn matching_transaction_ids(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    f: &TransactionFilters,
) -> Result<Vec<Uuid>, CoreError> {
    let ids = with_filter_args!(
        query_scalar!(
            r#"
        select id as "id!"
        from budget_transaction_matches($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        where source = 'cash'
        order by day desc, id
        "#
        ),
        user_id,
        f,
    )
    .fetch_all(pool)
    .await?;
    Ok(ids)
}
