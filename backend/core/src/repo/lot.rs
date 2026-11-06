//! Lots: purchases and sales as first-class records, separate from the cash
//! ledger in `transaction`.
//!
//! The basis rule itself lives in the `lot_basis` SQL function and NOWHERE
//! else — not here, not in the frontend. Everything in this module either
//! writes lot rows or asks that function a question.

use std::collections::BTreeSet;

use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;
use crate::repo::holding::{OwnedHolding, owned_holding};
use crate::text_enum::text_enum;

text_enum! {
    pub enum LotSide {
        Buy = "buy",
        Sell = "sell",
    }
}

text_enum! {
    /// Who recorded a lot. Users may delete only their own (`manual`) ones;
    /// a provider's come back at the next sync.
    pub enum LotSource {
        Manual = "manual",
        Provider = "provider",
    }
}

/// Decimal places a lot's quantity, unit price and fee may carry.
pub const LOT_DECIMAL_PLACES: u32 = 8;

/// A lot's quantity, unit price and fee are below 10^`LOT_MAX_INTEGER_DIGITS`.
pub const LOT_MAX_INTEGER_DIGITS: u32 = 12;

pub struct LotRow {
    pub id: Uuid,
    pub side: LotSide,
    pub acquired_on: NaiveDate,
    pub quantity: Decimal,
    pub unit_price: Decimal,
    pub fee: Decimal,
    /// A row the user entered, the only kind the record-lots modal may
    /// delete.
    pub manual: bool,
}

pub async fn list_lots(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    holding_id: Uuid,
) -> Result<Vec<LotRow>, CoreError> {
    let rows = sqlx::query_as!(
        LotRow,
        r#"
        select l.id as "id!", l.side as "side!: LotSide", l.acquired_on as "acquired_on!",
               l.quantity as "quantity!", l.unit_price as "unit_price!", l.fee as "fee!",
               (l.source = $3) as "manual!"
        from lot l
        join holding h    on h.id = l.holding_id
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where l.holding_id = $1 and c.user_id = $2
        order by l.acquired_on, l.created_at
        "#,
        holding_id,
        user_id,
        LotSource::Manual as LotSource,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A lot the user enters, checked so every read of its holding can value it.
pub struct NewLot {
    side: LotSide,
    acquired_on: NaiveDate,
    quantity: Decimal,
    unit_price: Decimal,
    fee: Decimal,
}

/// Why a lot is refused; the message is what the API answers with. The
/// frontend's `validateLot` and these rules are checked against the same
/// cases (`shared/lot-cases.json`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum InvalidLot {
    /// Names the field.
    #[error("{0} is not a decimal")]
    NotADecimal(&'static str),
    #[error("quantity must be positive and unitPrice must not be negative")]
    NonPositiveQuantity,
    #[error("quantity must be positive and unitPrice must not be negative")]
    NegativeUnitPrice,
    #[error("fee must not be negative")]
    NegativeFee,
    #[error("quantity, unitPrice and fee support at most 8 decimal places")]
    TooPrecise,
    #[error("quantity, unitPrice and fee must be below 10^12")]
    TooLarge,
    #[error("quantity * unitPrice does not fit in a decimal")]
    Overflow,
}

impl NewLot {
    /// A lot from the decimal strings the API receives; an absent fee is zero.
    pub fn parse(
        side: LotSide,
        acquired_on: NaiveDate,
        quantity: &str,
        unit_price: &str,
        fee: Option<&str>,
    ) -> Result<Self, InvalidLot> {
        let decimal = |value: &str, field| {
            is_plain_decimal(value)
                .then(|| value.parse::<Decimal>().ok())
                .flatten()
                .ok_or(InvalidLot::NotADecimal(field))
        };
        let quantity = decimal(quantity, "quantity")?;
        let unit_price = decimal(unit_price, "unitPrice")?;
        let fee = fee.map_or(Ok(Decimal::ZERO), |fee| decimal(fee, "fee"))?;
        Self::new(side, acquired_on, quantity, unit_price, fee)
    }

    pub fn new(
        side: LotSide,
        acquired_on: NaiveDate,
        quantity: Decimal,
        unit_price: Decimal,
        fee: Decimal,
    ) -> Result<Self, InvalidLot> {
        if quantity <= Decimal::ZERO {
            return Err(InvalidLot::NonPositiveQuantity);
        }
        if unit_price < Decimal::ZERO {
            return Err(InvalidLot::NegativeUnitPrice);
        }
        if fee < Decimal::ZERO {
            return Err(InvalidLot::NegativeFee);
        }
        // A lot that doesn't fit a `Decimal` would make every read of its holding fail.
        let figures = [quantity, unit_price, fee];
        if figures.iter().any(|f| f.scale() > LOT_DECIMAL_PLACES) {
            return Err(InvalidLot::TooPrecise);
        }
        let max_magnitude = Decimal::from(10i64.pow(LOT_MAX_INTEGER_DIGITS));
        if figures.iter().any(|f| f.abs() >= max_magnitude) {
            return Err(InvalidLot::TooLarge);
        }
        match quantity.checked_mul(unit_price) {
            Some(gross) if gross.scale() <= 28 => {}
            _ => return Err(InvalidLot::Overflow),
        }
        Ok(NewLot {
            side,
            acquired_on,
            quantity,
            unit_price,
            fee,
        })
    }
}

/// Digits with an optional sign and decimal point, as the lot form takes
/// them: `Decimal`'s parser also reads exponents and `_` separators.
fn is_plain_decimal(value: &str) -> bool {
    let unsigned = value.strip_prefix(['+', '-']).unwrap_or(value);
    let (int, frac) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    !(int.is_empty() && frac.is_empty())
        && int.bytes().chain(frac.bytes()).all(|b| b.is_ascii_digit())
}

/// An edit of a holding's user-entered (`manual`) lots. Provider lots are
/// never touched: they come back at the next sync.
pub struct LotChanges {
    adds: Vec<NewLot>,
    removes: Removes,
}

enum Removes {
    Ids(BTreeSet<Uuid>),
    AllManual,
}

impl LotChanges {
    /// Delete these manual lots and add these. Every id must name a manual lot
    /// of the holding, or nothing is written.
    pub fn edit(adds: Vec<NewLot>, deletes: impl IntoIterator<Item = Uuid>) -> Self {
        LotChanges {
            adds,
            removes: Removes::Ids(deletes.into_iter().collect()),
        }
    }

    /// Make `rows` the holding's whole set of manual lots.
    pub fn replace_manual(rows: Vec<NewLot>) -> Self {
        LotChanges {
            adds: rows,
            removes: Removes::AllManual,
        }
    }

    fn is_empty(&self) -> bool {
        self.adds.is_empty() && matches!(&self.removes, Removes::Ids(ids) if ids.is_empty())
    }
}

async fn apply(
    conn: &mut sqlx::PgConnection,
    holding: &OwnedHolding,
    changes: &LotChanges,
) -> Result<(), CoreError> {
    match &changes.removes {
        Removes::Ids(ids) if ids.is_empty() => {}
        Removes::Ids(ids) => {
            let ids: Vec<Uuid> = ids.iter().copied().collect();
            let deleted = sqlx::query!(
                r#"
                delete from lot
                where holding_id = $1 and source = $3 and id = any($2)
                "#,
                holding.id,
                &ids,
                LotSource::Manual as LotSource,
            )
            .execute(&mut *conn)
            .await?
            .rows_affected();
            if deleted != ids.len() as u64 {
                return Err(CoreError::NotFound("unknown entry"));
            }
        }
        Removes::AllManual => {
            sqlx::query!(
                "delete from lot where holding_id = $1 and source = $2",
                holding.id,
                LotSource::Manual as LotSource,
            )
            .execute(&mut *conn)
            .await?;
        }
    }

    if !changes.adds.is_empty() {
        let column = |f: fn(&NewLot) -> Decimal| changes.adds.iter().map(f).collect::<Vec<_>>();
        let sides: Vec<LotSide> = changes.adds.iter().map(|a| a.side).collect();
        let days: Vec<NaiveDate> = changes.adds.iter().map(|a| a.acquired_on).collect();
        sqlx::query!(
            r#"
            insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source)
            select $1, a.side, a.day, a.quantity, a.unit_price, a.fee, $7
            from unnest($2::text[], $3::date[], $4::numeric[], $5::numeric[], $6::numeric[])
                 as a(side, day, quantity, unit_price, fee)
            "#,
            holding.id,
            &sides as &[LotSide],
            &days,
            &column(|a| a.quantity),
            &column(|a| a.unit_price),
            &column(|a| a.fee),
            LotSource::Manual as LotSource,
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Apply `changes` to the caller's holding, all or nothing, and rebuild the
/// derived history: manual entry is the main path for securities, so the
/// chart must move now, not at the next sync.
pub async fn save(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    holding_id: Uuid,
    changes: &LotChanges,
) -> Result<(), CoreError> {
    let mut tx = crate::db::begin_user_writes(pool, user_id).await?;
    let holding = owned_holding(&mut *tx, user_id, holding_id).await?;
    if changes.is_empty() {
        return Ok(());
    }
    apply(&mut tx, &holding, changes).await?;
    crate::backfill::backfill_user(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

/// Figures in one currency. `unrealised` is `None` while today's price or
/// rate is unknown: no figure, not a total loss.
pub struct BasisFigures {
    pub mean_price: Decimal,
    pub invested: Decimal,
    pub realised: Decimal,
    pub unrealised: Option<Decimal>,
}

pub struct BasisPreview {
    pub explained_qty: Decimal,
    /// In the account's currency, the one lots are recorded in.
    pub account: BasisFigures,
    /// In the reader's currency; `None` while today's rate is unknown.
    pub reporting: Option<BasisFigures>,
}

/// What the figures WOULD be after saving `changes`.
///
/// Computed by applying them and rolling back, rather than by reimplementing
/// the rule against an in-memory list: a second implementation would drift
/// from the first and the screens would disagree, and the rollback means the
/// modal's live preview and the number the user gets after saving come from
/// the same function over the same rows.
pub async fn basis_preview(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    holding_id: Uuid,
    changes: &LotChanges,
) -> Result<BasisPreview, CoreError> {
    let mut tx = pool.begin().await?;
    let holding = owned_holding(&mut *tx, user_id, holding_id).await?;
    apply(&mut tx, &holding, changes).await?;

    let f = sqlx::query!(
        r#"
        with f as (
            select coalesce(b.mean_price, 0) as mean_price,
                   b.explained_qty, b.basis, b.realised,
                   fx_convert(b.explained_qty, unit_value_asof(h.instrument_id, t.d),
                              fx_asof(a.currency, t.d)) - b.basis as unrealised,
                   fx_asof(a.currency, t.d) as account_rate,
                   reporting_fx_asof($2, t.d) as reporting_rate
            from holding h
            join account a on a.id = h.account_id
            cross join (select user_today($2) as d) t
            cross join lateral lot_basis(array[h.id], array[t.d]) b
            where h.id = $1
        )
        select mean_price as "mean_price!", explained_qty as "explained_qty!",
               basis as "basis!", realised as "realised!", unrealised as "unrealised?",
               fx_convert(mean_price, account_rate, reporting_rate) as "rep_mean_price?",
               fx_convert(basis, account_rate, reporting_rate) as "rep_basis?",
               fx_convert(realised, account_rate, reporting_rate) as "rep_realised?",
               fx_convert(unrealised, account_rate, reporting_rate) as "rep_unrealised?"
        from f
        "#,
        holding.id,
        user_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    // Never commit: this was a question, not a change.
    tx.rollback().await?;

    let reporting = match (f.rep_mean_price, f.rep_basis, f.rep_realised) {
        (Some(mean_price), Some(invested), Some(realised)) => Some(BasisFigures {
            mean_price,
            invested,
            realised,
            unrealised: f.rep_unrealised,
        }),
        _ => None,
    };
    Ok(BasisPreview {
        explained_qty: f.explained_qty,
        account: BasisFigures {
            mean_price: f.mean_price,
            invested: f.basis,
            realised: f.realised,
            unrealised: f.unrealised,
        },
        reporting,
    })
}
