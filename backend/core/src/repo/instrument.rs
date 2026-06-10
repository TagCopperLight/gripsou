//! Resolve a canonical `InstrumentRef` to a global `instrument` row id,
//! creating it if absent. Instruments are shared across all users.

use uuid::Uuid;

use crate::dto::InstrumentRef;
use crate::error::CoreError;

pub async fn resolve_instrument(
    conn: &mut sqlx::PgConnection,
    ins: &InstrumentRef,
) -> Result<Uuid, CoreError> {
    if ins.kind == "cash" {
        let id = sqlx::query_scalar!(
            r#"
            insert into instrument (kind, symbol, isin, name, currency)
            values ('cash', null, null, $1, $2)
            on conflict (currency) where kind = 'cash'
            do update set name = excluded.name
            returning id
            "#,
            ins.name,
            ins.currency,
        )
        .fetch_one(&mut *conn)
        .await?;
        return Ok(id);
    }

    if let Some(isin) = &ins.isin {
        let id = sqlx::query_scalar!(
            r#"
            insert into instrument (kind, symbol, isin, name, currency)
            values ($1, $2, $3, $4, $5)
            on conflict (isin) where isin is not null
            do update set name = excluded.name
            returning id
            "#,
            ins.kind,
            ins.symbol,
            isin,
            ins.name,
            ins.currency,
        )
        .fetch_one(&mut *conn)
        .await?;
        return Ok(id);
    }

    if let Some(symbol) = &ins.symbol {
        let id = sqlx::query_scalar!(
            r#"
            insert into instrument (kind, symbol, isin, name, currency)
            values ($1, $2, null, $3, $4)
            on conflict (kind, symbol) where symbol is not null
            do update set name = excluded.name
            returning id
            "#,
            ins.kind,
            symbol,
            ins.name,
            ins.currency,
        )
        .fetch_one(&mut *conn)
        .await?;
        return Ok(id);
    }

    Err(CoreError::MissingInstrumentId {
        name: ins.name.clone(),
    })
}
