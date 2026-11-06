//! Lots: purchases and sales as first-class records, separate from the cash
//! ledger in `transaction`.
//!
//! The basis rule itself lives in the `lot_basis` SQL function (0022) and
//! NOWHERE else — not here, not in `query.rs`, not in the frontend. Everything
//! in this module either writes lot rows or asks that function a question.

use std::collections::BTreeSet;

use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;
use crate::repo::holding::{OwnedHolding, owned_holding};

/// Decimal places a lot's quantity, unit price and fee may carry.
pub const LOT_DECIMAL_PLACES: u32 = 8;

pub struct LotRow {
    pub id: Uuid,
    pub side: String,
    pub acquired_on: NaiveDate,
    pub quantity: Decimal,
    pub unit_price: Decimal,
    pub fee: Decimal,
    /// `source = 'manual'` — a row the user entered, and the only kind the
    /// record-lots modal may delete.
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
        select l.id as "id!", l.side as "side!", l.acquired_on as "acquired_on!",
               l.quantity as "quantity!", l.unit_price as "unit_price!", l.fee as "fee!",
               (l.source = 'manual') as "manual!"
        from lot l
        join holding h    on h.id = l.holding_id
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where l.holding_id = $1 and c.user_id = $2
        order by l.acquired_on, l.created_at
        "#,
        holding_id,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A lot the user enters, checked so every read of its holding can value it.
pub struct NewLot {
    side: &'static str,
    acquired_on: NaiveDate,
    quantity: Decimal,
    unit_price: Decimal,
    fee: Decimal,
}

impl NewLot {
    /// The error is the message the API answers with.
    pub fn new(
        side: &str,
        acquired_on: NaiveDate,
        quantity: Decimal,
        unit_price: Decimal,
        fee: Decimal,
    ) -> Result<Self, &'static str> {
        let side = match side {
            "buy" => "buy",
            "sell" => "sell",
            _ => return Err("type must be buy or sell"),
        };
        if quantity <= Decimal::ZERO || unit_price < Decimal::ZERO {
            return Err("quantity must be positive and unitPrice must not be negative");
        }
        if fee < Decimal::ZERO {
            return Err("fee must not be negative");
        }
        // A lot that doesn't fit a `Decimal` would make every read of its holding fail.
        let figures = [quantity, unit_price, fee];
        if figures.iter().any(|f| f.scale() > LOT_DECIMAL_PLACES) {
            return Err("quantity, unitPrice and fee support at most 8 decimal places");
        }
        let max_magnitude = Decimal::from(1_000_000_000_000i64);
        if figures.iter().any(|f| f.abs() >= max_magnitude) {
            return Err("quantity, unitPrice and fee must be below 10^12");
        }
        match quantity.checked_mul(unit_price) {
            Some(gross) if gross.scale() <= 28 => {}
            _ => return Err("quantity * unitPrice does not fit in a decimal"),
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
                where holding_id = $1 and source = 'manual' and id = any($2)
                "#,
                holding.id,
                &ids,
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
                "delete from lot where holding_id = $1 and source = 'manual'",
                holding.id,
            )
            .execute(&mut *conn)
            .await?;
        }
    }

    if !changes.adds.is_empty() {
        let column = |f: fn(&NewLot) -> Decimal| changes.adds.iter().map(f).collect::<Vec<_>>();
        let sides: Vec<String> = changes.adds.iter().map(|a| a.side.to_owned()).collect();
        let days: Vec<NaiveDate> = changes.adds.iter().map(|a| a.acquired_on).collect();
        sqlx::query!(
            r#"
            insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source)
            select $1, a.side, a.day, a.quantity, a.unit_price, a.fee, 'manual'
            from unnest($2::text[], $3::date[], $4::numeric[], $5::numeric[], $6::numeric[])
                 as a(side, day, quantity, unit_price, fee)
            "#,
            holding.id,
            &sides,
            &days,
            &column(|a| a.quantity),
            &column(|a| a.unit_price),
            &column(|a| a.fee),
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
