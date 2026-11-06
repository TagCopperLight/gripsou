//! Read-side aggregations for the dashboard, all scoped by user_id
//! (joined via connection.user_id). Money stays Decimal end-to-end.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

pub struct NetWorthRow {
    pub as_of: NaiveDate,
    pub net_worth: Decimal,
    pub invested: Decimal,
    /// Something on this day was left out for want of a rate: a holding
    /// valued at zero, a basis missing from `invested`, or, when the reader's
    /// currency had no rate, the whole day.
    pub fx_missing: bool,
}

pub async fn net_worth_series(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<NetWorthRow>, CoreError> {
    net_worth_series_with_target(
        pool,
        user_id,
        from,
        to,
        crate::repo::series::CHART_TARGET_POINTS,
    )
    .await
}

/// Same as [`net_worth_series`] but with the sample target exposed. Exists so
/// the golden sampling tests (`tests/golden.rs`) can force a small target
/// against the fixed-size seeded scenario, which is otherwise too short to
/// ever produce a stride above 1. Not part of the public API.
#[doc(hidden)]
pub async fn net_worth_series_with_target(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
    target: usize,
) -> Result<Vec<NetWorthRow>, CoreError> {
    // Clamp to real history, then sample. `range=max` asks for 4000 days
    // regardless of how much exists, and a 4000-point line is drawn into about
    // 800 pixels.
    let start = crate::repo::series::history_start(pool, user_id)
        .await?
        .map_or(from, |h| h.max(from));
    let days = crate::repo::series::sample_days(start, to, target);

    // Net worth is the sum of the account values: rows come ordered by day,
    // so each day's accounts are consecutive.
    let mut rows: Vec<NetWorthRow> = Vec::new();
    for r in account_day_values(pool, user_id, &days).await? {
        match rows.last_mut() {
            Some(day) if day.as_of == r.as_of => {
                day.net_worth += r.value;
                day.invested += r.invested;
                day.fx_missing |= r.fx_missing;
            }
            _ => rows.push(NetWorthRow {
                as_of: r.as_of,
                net_worth: r.value,
                invested: r.invested,
                fx_missing: r.fx_missing,
            }),
        }
    }
    Ok(rows)
}

/// One account on one day, valued for both the net-worth line and the
/// stacked accounts chart.
struct AccountDayRow {
    account_id: Uuid,
    name: String,
    color: String,
    as_of: NaiveDate,
    value: Decimal,
    invested: Decimal,
    fx_missing: bool,
}

/// The one per-day valuation (`holding_day_values`), grouped by (day,
/// account), ordered by day.
///
/// `days` is not every day in the range: [`crate::repo::series::sample_days`]
/// clamps the axis to real history and samples it down first.
async fn account_day_values(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    days: &[NaiveDate],
) -> Result<Vec<AccountDayRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountDayRow,
        r#"
        select a.id    as "account_id!",
               a.name  as "name!",
               a.color as "color",
               v.as_of as "as_of!",
               coalesce(fx_convert(sum(v.value), 1, v.reporting_rate), 0) as "value!",
               coalesce(fx_convert(sum(v.invested), 1, v.reporting_rate), 0) as "invested!",
               coalesce(bool_or(v.fx_missing), false) as "fx_missing!"
        from holding_day_values($1, $2) v
        join account a on a.id = v.account_id
        group by v.as_of, a.id, a.name, a.color, v.reporting_rate
        order by v.as_of, a.id
        "#,
        user_id,
        days,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct HoldingRow {
    pub holding_id: Uuid,
    pub symbol: Option<String>,
    pub instrument_name: String,
    pub kind: String,
    pub logo_url: Option<String>,
    /// The instrument's own currency — the currency the security is *quoted* in.
    /// Not the currency of any amount on this row.
    pub currency: String,
    /// Currency of the `price` row `price` came from — the price domain. May
    /// differ from `currency` (Powens labels an instrument EUR, Yahoo resolves a
    /// London listing quoted GBP). NULL when there is no price row.
    pub price_currency: Option<String>,
    /// The account's currency — the amount domain. `cost_basis`,
    /// `invested_native`, snapshot values and transaction amounts are all in it.
    pub account_currency: String,
    pub account_id: Uuid,
    pub account_name: String,
    pub account_color: String,
    /// Stable account-type key (`checking`, `pea`, …); the frontend translates it.
    pub type_key: String,
    pub quantity: Decimal,
    /// Latest unit price, in `price_currency` (NOT `currency`).
    pub price: Option<Decimal>,
    /// Last 30 daily unit prices, ascending by time. Empty if none.
    pub spark: Vec<Decimal>,
    /// ETF/fund country and sector breakdown, when available in instrument.meta.
    pub composition: Option<crate::dto::Composition>,
    /// Position value in the reader's reporting currency. Zero when a rate is
    /// unknown (see `fx_missing`).
    pub value: Decimal,
    /// Cost basis in the reader's reporting currency. Zero when a rate is
    /// unknown (see `fx_missing`).
    pub invested: Decimal,
    /// Cost basis in the *account's* currency — the amount-domain figure, which
    /// is what the provider denominated it in. Label it with `account_currency`,
    /// never with `currency` or `price_currency`.
    pub invested_native: Decimal,
    /// `value` or `invested` reads zero for want of a rate
    /// (`holding_valuation`).
    pub fx_missing: bool,
    /// Shares no recorded lot explains: `quantity − Σ buys + Σ sells`.
    /// Signed: positive means shares no lot explains, negative means more is
    /// recorded than held (an unrecorded sale). Non-zero means the cost basis
    /// and the pre-purchase history are guesses, which the Holdings badge says
    /// out loud. Always zero for cash — a cash line has nothing to explain.
    pub unexplained_quantity: Decimal,
    /// Fee-inclusive mean buy price, amount domain (account currency). When
    /// no buy is recorded (a provider that reports a balance but no lots), the
    /// basis over the quantity, so a real position does not read as zero.
    pub mean_price: Decimal,
}

pub async fn holdings(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<HoldingRow>, CoreError> {
    struct Base {
        holding_id: Uuid,
        symbol: Option<String>,
        instrument_name: String,
        kind: String,
        isin: Option<String>,
        raw_symbol: Option<String>,
        currency: String,
        price_currency: Option<String>,
        account_currency: String,
        instrument_id: Uuid,
        account_id: Uuid,
        account_name: String,
        account_color: String,
        type_key: String,
        quantity: Decimal,
        price: Option<Decimal>,
        composition: Option<serde_json::Value>,
        value: Decimal,
        invested: Decimal,
        invested_native: Decimal,
        fx_missing: bool,
        unexplained_quantity: Decimal,
        mean_price: Decimal,
    }

    let bases = sqlx::query_as!(
        Base,
        r#"
        -- Valued by the same rule as every other reader (`holding_valuation`),
        -- from the holding's current quantity and its latest snapshot. The
        -- snapshot lateral is LEFT because a holding ingested before its first
        -- snapshot must still list (it just has no provider valuation).
        --
        -- Today is `user_today($1)` in each call, never a sub-select: Postgres
        -- does not inline a SQL function given a sub-select argument, and the
        -- opaque calls' cost estimate turns on JIT, which takes a second.
        with grid as materialized (
            select * from valuation_grid($1, array[user_today($1)])
        ),
        fx as materialized (select currency, unit_value from grid where kind = 'cash'),
        rep as materialized (
            select unit_value from fx
            where currency = (select currency from users where id = $1)
        )
        select h.id            as "holding_id!",
               -- Display ticker, not the identity column. `symbol` is null on
               -- the ISIN path (ISIN is the identity there, and tickers are not
               -- globally unique), so the resolved Yahoo ticker in meta is what
               -- the user should see. Cash is excluded: its meta holds an FX
               -- pair like `CNYEUR=X`, a fetch detail, and the UI falls back to
               -- the ISO code.
               coalesce(
                   i.symbol,
                   case when i.kind <> 'cash' then i.meta->>'yahoo_symbol' end
               )               as "symbol",
               i.name          as "instrument_name!",
               i.kind          as "kind!",
               i.isin,
               i.symbol        as "raw_symbol",
               i.meta->'composition' as "composition?",
               i.currency      as "currency!",
               px.currency     as "price_currency?",
               a.currency      as "account_currency!",
               i.id            as "instrument_id!",
               a.id            as "account_id!",
               a.name          as "account_name!",
               a.color         as "account_color",
               a.type_key      as "type_key!",
               h.quantity      as "quantity!",
               px.unit_price   as "price?",
               coalesce(fx_convert(v.value, 1, rep.unit_value), 0) as "value!",
               coalesce(fx_convert(v.invested, 1, rep.unit_value), 0) as "invested!",
               lot.basis      as "invested_native!",
               lot.mean_price as "mean_price!",
               v.fx_missing   as "fx_missing!",
               -- Shares no recorded lot explains. Scoped to THIS holding's
               -- (account, instrument) via the `lot` lateral — never the
               -- instrument alone, or another user's buy of the same ETF would
               -- reduce this figure.
               --
               -- SIGNED, deliberately: negative means more is recorded than is
               -- held. Flooring it at zero would hide that state, and the user
               -- could never open the modal to fix it.
               case when i.kind = 'cash' then 0
                    else h.quantity - coalesce(lot.explained_qty, 0)
               end as "unexplained_quantity!"
        from holding h
        join account a      on a.id = h.account_id
        join connection c   on c.id = a.connection_id
        join instrument i   on i.id = h.instrument_id
        left join lateral (
            select p.unit_price, p.currency
            from price p
            where p.instrument_id = i.id
              and p.ts < ((user_today($1) + 1)::timestamp at time zone 'UTC')
            order by p.ts desc
            limit 1
        ) px on true
        left join lateral (
            select hs.value
            from holding_snapshot hs
            where hs.holding_id = h.id
            order by hs.as_of desc
            limit 1
        ) snap on true
        left join lateral (
            select case when coalesce(b.mean_price, 0) = 0
                        then coalesce(b.basis / nullif(h.quantity, 0), 0)
                        else b.mean_price end as mean_price,
                   b.explained_qty,
                   b.basis
            from lot_basis(array[h.id], array[user_today($1)]) b
        ) lot on true
        left join grid uv on uv.instrument_id = i.id
        left join fx afx  on afx.currency = a.currency
        left join rep     on true
        cross join lateral holding_valuation(
            h.quantity, uv.unit_value, snap.value, lot.basis, afx.unit_value, rep.unit_value
        ) v
        where c.user_id = $1 and h.quantity <> 0
        order by h.id
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(bases.len());
    for b in bases {
        // Cash rows show no sparkline (their "prices" are FX rates), so don't
        // pay for the query.
        // The last 30 *days*, not the last 30 rows: a row count silently covers a
        // different window whenever the feed's cadence changes, so the "30D"
        // label stops meaning 30D. A market instrument yields ~21 points here
        // (weekends have no price), which is the honest shape.
        //
        // ponytail: no cap on the row count. A daily feed makes this ~30 rows;
        // add a sample-down (repo::series) if an intraday feed ever lands here.
        let spark: Vec<Decimal> = if b.kind == "cash" {
            Vec::new()
        } else {
            sqlx::query_scalar!(
                r#"
                select unit_price as "unit_price!"
                from price
                where instrument_id = $1
                  and ts >= now() - interval '30 days'
                order by ts
                "#,
                b.instrument_id,
            )
            .fetch_all(pool)
            .await?
        };

        out.push(HoldingRow {
            holding_id: b.holding_id,
            symbol: b.symbol,
            instrument_name: b.instrument_name,
            logo_url: crate::logo::instrument_logo_url(
                &b.kind,
                b.isin.as_deref(),
                b.raw_symbol.as_deref(),
            ),
            kind: b.kind,
            currency: b.currency,
            price_currency: b.price_currency,
            account_currency: b.account_currency,
            account_id: b.account_id,
            account_name: b.account_name,
            account_color: b.account_color,
            type_key: b.type_key,
            quantity: b.quantity,
            price: b.price,
            spark,
            composition: b.composition.and_then(|v| serde_json::from_value(v).ok()),
            value: b.value,
            invested: b.invested,
            invested_native: b.invested_native,
            fx_missing: b.fx_missing,
            unexplained_quantity: b.unexplained_quantity,
            mean_price: b.mean_price,
        });
    }
    Ok(out)
}

pub struct PricePointRow {
    pub ts: DateTime<Utc>,
    /// In the price row's own currency (the listing's quote).
    pub unit_price: Decimal,
    /// The same price in the holding's account currency, at that day's rates:
    /// the domain lots are recorded in, so it can sit next to them. Null when
    /// either rate is unknown.
    pub account_price: Option<Decimal>,
    /// The same price in the reader's currency at that day's rates. Null when
    /// either rate is unknown.
    pub reporting_price: Option<Decimal>,
    /// Shares held that day as the lots explain them. Null before the first lot.
    pub qty: Option<Decimal>,
    /// Cost basis that day (`lot_basis`), in the account's currency. Null
    /// before the first lot.
    pub invested: Option<Decimal>,
    /// `invested` in the reader's currency. Null when either rate is unknown.
    pub reporting_invested: Option<Decimal>,
}

pub async fn holding_prices(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    holding_id: Uuid,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<PricePointRow>, CoreError> {
    let rows = sqlx::query_as!(
        PricePointRow,
        r#"
        with pts as materialized (
            select p.ts, p.unit_price, p.currency as quote, a.currency as acct,
                   u.currency as rep, (p.ts at time zone 'utc')::date as day
            from price p
            join holding h    on h.instrument_id = p.instrument_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
            join users u      on u.id = c.user_id
            where h.id = $1 and c.user_id = $2 and p.ts between $3 and $4
        ),
        rates as materialized (
            select as_of, currency, rate
            from fx_grid(
                array(select distinct day from pts),
                array(select quote from pts
                      union select acct from pts
                      union select rep from pts)
            )
        ),
        lots as (
            select h.quantity as held,
                   (select min(l.acquired_on) from lot l where l.holding_id = h.id) as first_day
            from holding h
            where h.id = $1
        ),
        basis as materialized (
            select as_of, explained_qty, basis
            from lot_basis(array[$1]::uuid[], array(select distinct day from pts))
        )
        select pts.ts as "ts!", pts.unit_price as "unit_price!",
               fx_convert(pts.unit_price, q.rate, ac.rate) as "account_price?",
               fx_convert(pts.unit_price, q.rate, rp.rate) as "reporting_price?",
               pos.qty as "qty?",
               pos.invested as "invested?",
               fx_convert(pos.invested, ac.rate, rp.rate) as "reporting_invested?"
        from pts
        left join rates q  on q.currency = pts.quote and q.as_of = pts.day
        left join rates ac on ac.currency = pts.acct and ac.as_of = pts.day
        left join rates rp on rp.currency = pts.rep and rp.as_of = pts.day
        cross join lots
        left join basis b on b.as_of = pts.day
        -- No position before the first lot. A holding with no lot at all (a
        -- provider that reports balances only) is held flat at its quantity.
        left join lateral (
            select case when lots.first_day is null then lots.held
                        else b.explained_qty end as qty,
                   b.basis as invested
            where lots.first_day is null or pts.day >= lots.first_day
        ) pos on true
        order by pts.ts
        "#,
        holding_id,
        user_id,
        from,
        to,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct AccountRow {
    pub account_id: Uuid,
    pub connection_id: Uuid,
    pub name: String,
    pub color: String,
    pub type_key: String,
    pub value: Decimal,
    pub currency: String,
    pub value_native: Option<Decimal>,
    pub fx_missing: bool,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub institution_key: Option<String>,
    pub institution_name: Option<String>,
    pub provider_key: String,
}

/// One row per account valued today, by the same `holding_day_values` as the
/// net-worth chart, so the accounts grid sums to the chart's last point.
pub async fn accounts(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<AccountRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountRow,
        r#"
        with v as (
            select v.account_id,
                   sum(v.value) as value,
                   v.account_rate,
                   v.reporting_rate,
                   bool_or(v.fx_missing) as fx_missing
            from holding_day_values($1, array[user_today($1)]) v
            group by v.account_id, v.account_rate, v.reporting_rate
        )
        select a.id    as "account_id!",
               c.id    as "connection_id!",
               a.name  as "name!",
               a.color,
               a.type_key as "type_key!",
               coalesce(fx_convert(v.value, 1, v.reporting_rate), 0) as "value!",
               a.currency as "currency!",
               -- The same sum in the account's own currency.
               fx_convert(v.value, 1, v.account_rate) as "value_native?",
               coalesce(v.fx_missing, false) as "fx_missing!",
               c.last_sync_at,
               c.institution_key,
               c.institution_name,
               c.provider_key
        from v
        join account a    on a.id = v.account_id
        join connection c on c.id = a.connection_id
        order by v.value desc
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct AccountSeriesRow {
    pub account_id: Uuid,
    pub name: String,
    pub color: String,
    pub as_of: NaiveDate,
    pub value: Decimal,
}

/// Stacked-area source: each account's value per day over a window, from the
/// same valuation as [`net_worth_series`].
pub async fn account_series(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<AccountSeriesRow>, CoreError> {
    let start = crate::repo::series::history_start(pool, user_id)
        .await?
        .map_or(from, |h| h.max(from));
    let days =
        crate::repo::series::sample_days(start, to, crate::repo::series::CHART_TARGET_POINTS);

    let rows = account_day_values(pool, user_id, &days)
        .await?
        .into_iter()
        .map(|r| AccountSeriesRow {
            account_id: r.account_id,
            name: r.name,
            color: r.color,
            as_of: r.as_of,
            value: r.value,
        })
        .collect();
    Ok(rows)
}

/// Every account-type key. New types are data inserts here — no code change
/// needed to offer them in the edit-account dropdown.
pub async fn account_types(pool: &sqlx::PgPool) -> Result<Vec<String>, CoreError> {
    let keys = sqlx::query_scalar!("select key from account_type order by key")
        .fetch_all(pool)
        .await?;
    Ok(keys)
}

pub struct UserRow {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
    pub avatar: Option<String>,
}

/// Every user on the server, oldest first (the seeded admin sorts first).
/// Global, not user-scoped: the admin Users page lists everyone.
pub async fn users(pool: &sqlx::PgPool) -> Result<Vec<UserRow>, CoreError> {
    let rows = sqlx::query_as!(
        UserRow,
        r#"
        select id, name, email, role, created_at, prefs->>'avatar' as avatar
        from users
        order by created_at
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
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
    /// `"cash"` for a `transaction` row, `"lot"` for a purchase/sale that now
    /// lives in the `lot` table. Structured, not a pre-built sentence: the
    /// frontend's i18n and per-user number formatting render the lot fields.
    pub source: String,
    pub ticker: Option<String>,
    /// What a lot row's logo is built from (`logo::instrument_logo_url`);
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
    pub category_kind: Option<String>,
    pub category_source: Option<String>,
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

/// The TYPE control on the filter panel: one value, always one selected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TypeBucket {
    #[default]
    All,
    MoneyIn,
    MoneyOut,
    Lots,
}

impl TypeBucket {
    /// Wire form, as the API query parameter spells it. `None` for anything
    /// else: an unknown bucket must never widen to `all`.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "all" => Some(Self::All),
            "in" => Some(Self::MoneyIn),
            "out" => Some(Self::MoneyOut),
            "lots" => Some(Self::Lots),
            _ => None,
        }
    }

    fn as_sql(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::MoneyIn => "in",
            Self::MoneyOut => "out",
            Self::Lots => "lots",
        }
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
            review_threshold: Decimal::new(
                crate::repo::prefs::DEFAULT_BUDGET_AI_THRESHOLD.into(),
                2,
            ),
            limit: 200,
            offset: 0,
        }
    }
}

/// The Transactions page. The rows and the filter are the
/// `budget_transaction_matches` SQL function (migration 0028), which the
/// header counts and the bulk target read too, so the three cannot disagree
/// about which rows a filter admits. Every filter is optional inside it, so
/// one prepared statement covers all combinations and the macro still checks
/// this query at compile time.
pub async fn transactions(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    f: &TransactionFilters,
) -> Result<Vec<TransactionListRow>, CoreError> {
    let rows = sqlx::query_as!(
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
               source as "source!", ticker, instrument_kind, instrument_isin,
               instrument_symbol, quantity, unit_price, fee,
               account_id as "account_id!", account_name as "account_name!",
               account_color as "account_color!", account_currency as "account_currency!",
               filtered.category_id, category_name, category_default_key, category_color,
               category_icon, category_kind, category_source, category_confidence,
               needs_review as "needs_review!", checked as "checked!",
               is_transfer as "is_transfer!",
               is_orphan_transfer as "is_orphan_transfer!"
        from filtered
        left join grid afx on afx.as_of = filtered.day
                          and afx.currency = filtered.account_currency
        left join grid rfx on rfx.as_of = filtered.day
                          and rfx.currency = (select code from reporting)
        order by day desc, id
        "#,
        user_id,
        f.review_threshold,
        f.search,
        f.account_id,
        f.from,
        f.to,
        f.bucket.as_sql(),
        &f.category_ids,
        &f.tag_ids,
        f.uncategorized,
        f.needs_review,
        f.include_transfers,
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
        join transaction t on t.id = tt.transaction_id
        join account a     on a.id = t.account_id
        join connection k  on k.id = a.connection_id
        where tt.transaction_id = any($1)
          and k.user_id = $2
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
    let row = sqlx::query!(
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
        "#,
        user_id,
        f.review_threshold,
        f.search,
        f.account_id,
        f.from,
        f.to,
        f.bucket.as_sql(),
        &f.category_ids,
        &f.tag_ids,
        f.uncategorized,
        f.needs_review,
        f.include_transfers,
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
    let ids = sqlx::query_scalar!(
        r#"
        select id as "id!"
        from budget_transaction_matches($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        where source = 'cash'
        order by day desc, id
        "#,
        user_id,
        f.review_threshold,
        f.search,
        f.account_id,
        f.from,
        f.to,
        f.bucket.as_sql(),
        &f.category_ids,
        &f.tag_ids,
        f.uncategorized,
        f.needs_review,
        f.include_transfers,
    )
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

pub struct PriceEligibleInstrument {
    pub id: Uuid,
    pub kind: String,
    pub symbol: Option<String>,
    pub isin: Option<String>,
    pub name: String,
    pub currency: String,
    pub meta: serde_json::Value,
}

/// Instruments worth a composition scrape: non-cash, holds a symbol/isin, not
/// already marked "none", and composition missing or older than 30 days.
pub async fn composition_eligible_instruments_for_connection(
    pool: &sqlx::PgPool,
    connection_id: Uuid,
) -> Result<Vec<PriceEligibleInstrument>, CoreError> {
    let rows = sqlx::query_as!(
        PriceEligibleInstrument,
        r#"
        select distinct
               i.id       as "id!",
               i.kind     as "kind!",
               i.symbol,
               i.isin,
               i.name     as "name!",
               i.currency as "currency!",
               i.meta     as "meta!"
        from holding h
        join account a    on a.id = h.account_id
        join instrument i on i.id = h.instrument_id
        where a.connection_id = $1
          and i.kind <> 'cash'
          and h.quantity <> 0
          and (i.symbol is not null or i.isin is not null)
          and coalesce(i.meta->>'composition_status', '') <> 'none'
          and (
            i.meta->'composition'->>'as_of' is null
            or (i.meta->'composition'->>'as_of')::date < (now() at time zone 'utc')::date - 30
          )
        order by i.name
        "#,
        connection_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Distinct non-cash instruments held (nonzero quantity) under a connection,
/// plus the cash instrument (the FX rate) for every currency this connection
/// needs a rate for, excluding the pivot (`connection_fx_currencies`, which
/// says why each one is needed).
///
/// Drives the per-connection price-fetch pass.
pub async fn price_eligible_instruments_for_connection(
    pool: &sqlx::PgPool,
    connection_id: Uuid,
) -> Result<Vec<PriceEligibleInstrument>, CoreError> {
    let rows = sqlx::query_as!(
        PriceEligibleInstrument,
        r#"
        select distinct
               i.id       as "id!",
               i.kind     as "kind!",
               i.symbol,
               i.isin,
               i.name     as "name!",
               i.currency as "currency!",
               i.meta     as "meta!"
        from holding h
        join account a    on a.id = h.account_id
        join instrument i on i.id = h.instrument_id
        where a.connection_id = $1
          and i.kind <> 'cash'
          and h.quantity <> 0

        union

        -- Foreign cash is eligible: its "price" is the FX rate. Cash in the
        -- pivot is 1 by definition and has no Yahoo pair.
        select fx.id       as "id!",
               fx.kind     as "kind!",
               fx.symbol,
               fx.isin,
               fx.name     as "name!",
               fx.currency as "currency!",
               fx.meta     as "meta!"
        from connection_fx_currencies($1) cur
        join instrument fx on fx.kind = 'cash' and fx.currency = cur

        order by 5
        "#,
        connection_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
