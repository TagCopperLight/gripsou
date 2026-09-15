//! Lots: purchases and sales as first-class records, separate from the cash
//! ledger in `transaction`.
//!
//! The basis rule itself lives in the `lot_basis` SQL function (0022) and
//! NOWHERE else — not here, not in `query.rs`, not in the frontend. Everything
//! in this module either writes lot rows or asks that function a question.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

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

/// Insert a user-entered lot. Returns `None` when the holding does not exist or
/// is not the caller's — the select supplies the row, so a foreign holding
/// simply produces no insert rather than an error to distinguish.
#[allow(clippy::too_many_arguments)]
pub async fn insert_lot(
    conn: &mut sqlx::PgConnection,
    holding_id: Uuid,
    user_id: Uuid,
    side: &str,
    acquired_on: NaiveDate,
    quantity: Decimal,
    unit_price: Decimal,
    fee: Decimal,
) -> Result<Option<Uuid>, CoreError> {
    let id = sqlx::query_scalar!(
        r#"
        insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source)
        select h.id, $2, $3, $4, $5, $6, 'manual'
        from holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1 and c.user_id = $7
        returning id
        "#,
        holding_id,
        side,
        acquired_on,
        quantity,
        unit_price,
        fee,
        user_id,
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(id)
}

/// Delete user-entered lots by id, returning how many actually went. The
/// predicate is the whole security model of the delete path: a row must belong
/// to THIS holding, be `source = 'manual'`, and sit under a connection owned by
/// `user_id`. The caller compares the returned count against the ids it asked
/// for — any shortfall means one of those held, and the batch is rejected
/// wholesale.
pub async fn delete_lots(
    conn: &mut sqlx::PgConnection,
    holding_id: Uuid,
    user_id: Uuid,
    ids: &[Uuid],
) -> Result<u64, CoreError> {
    let deleted = sqlx::query!(
        r#"
        delete from lot l
        using holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1
          and c.user_id = $2
          and l.holding_id = h.id
          and l.source = 'manual'
          and l.id = any($3)
        "#,
        holding_id,
        user_id,
        ids,
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(deleted)
}

pub struct BasisFigures {
    pub mean_price: Decimal,
    pub explained_qty: Decimal,
    pub basis: Decimal,
    pub realised: Decimal,
}

pub struct PreviewLot {
    pub side: String,
    pub acquired_on: NaiveDate,
    pub quantity: Decimal,
    pub unit_price: Decimal,
    pub fee: Decimal,
}

/// What the figures WOULD be if `rows` were this holding's lots.
///
/// Computed by writing them and rolling back, rather than by reimplementing the
/// rule against an in-memory list. That is deliberate: a second implementation
/// is exactly the disease this whole change cures (AUDIT.md Z-1), and the
/// rollback means the modal's live preview and the number the user gets after
/// saving come from the same function over the same rows.
///
/// That equivalence holds only for the rows the two paths actually touch.
/// This preview deletes and replaces *every* lot on the holding regardless of
/// `source`, while `save_lots`/`delete_lots` (the real write path) refuse to
/// touch a non-`manual` row. Today the two agree because nothing but this
/// flow writes lots, but 0021 explicitly plans for a future provider that
/// does — once one exists, a holding with provider lots would preview against
/// a set of rows that saving can never actually produce.
///
/// `Ok(None)` means the holding is unknown or not the caller's — mirroring
/// `insert_lot`'s `Option`-for-unowned pattern in this same module, and
/// matching `save_lots` (the handler this preview endpoint sits beside),
/// which reads an unowned holding as 404 so the endpoint never confirms the
/// existence of ids the caller cannot see. The caller MUST render `Ok(None)`
/// as 404 to keep that property; do not treat it as a 500/`CoreError`.
pub async fn basis_preview(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    holding_id: Uuid,
    rows: &[PreviewLot],
) -> Result<Option<BasisFigures>, CoreError> {
    let mut tx = pool.begin().await?;

    // Ownership is checked once, here: everything below addresses the holding
    // directly, so an unowned id must not get as far as the insert.
    let owned: Option<Uuid> = sqlx::query_scalar!(
        r#"
        select h.id
        from holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1 and c.user_id = $2
        "#,
        holding_id,
        user_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    if owned.is_none() {
        tx.rollback().await?;
        return Ok(None);
    }

    sqlx::query!("delete from lot where holding_id = $1", holding_id)
        .execute(&mut *tx)
        .await?;

    for r in rows {
        sqlx::query!(
            r#"
            insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source)
            values ($1, $2, $3, $4, $5, $6, 'manual')
            "#,
            holding_id,
            r.side,
            r.acquired_on,
            r.quantity,
            r.unit_price,
            r.fee,
        )
        .execute(&mut *tx)
        .await?;
    }

    let f = sqlx::query!(
        r#"
        select coalesce(b.mean_price, 0) as "mean_price!",
               b.explained_qty as "explained_qty!",
               b.basis as "basis!",
               b.realised as "realised!"
        from lot_basis(array[$1]::uuid[], array[(now() at time zone 'utc')::date]) b
        "#,
        holding_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    // Never commit: this was a question, not a change.
    tx.rollback().await?;

    Ok(Some(BasisFigures {
        mean_price: f.mean_price,
        explained_qty: f.explained_qty,
        basis: f.basis,
        realised: f.realised,
    }))
}
