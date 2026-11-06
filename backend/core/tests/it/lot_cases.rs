//! The server's lot rules against `shared/lot-cases.json`, which the
//! frontend's copies (`frontend/src/lib/lotRules.ts`) run through too.

use chrono::NaiveDate;
use gripsou_core::repo::lot::{InvalidLot, LotSide, NewLot};
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::PgPool;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cases {
    cash_amount: Vec<CashCase>,
    validation: Vec<ValidationCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CashCase {
    case: String,
    side: String,
    quantity: Decimal,
    unit_price: Decimal,
    fee: Option<Decimal>,
    amount: Decimal,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidationCase {
    case: String,
    quantity: String,
    unit_price: String,
    fee: Option<String>,
    /// The frontend's reason code (`LotValidationError`).
    refused: Option<String>,
}

fn cases() -> Cases {
    serde_json::from_str(include_str!("../../../../shared/lot-cases.json"))
        .expect("shared/lot-cases.json matches the cases' shape")
}

/// The frontend's reason code for a refusal.
fn reason(err: InvalidLot) -> &'static str {
    match err {
        InvalidLot::NotADecimal(_) => "invalidNumber",
        InvalidLot::NonPositiveQuantity => "nonPositiveQuantity",
        InvalidLot::NegativeUnitPrice => "negativeUnitPrice",
        InvalidLot::NegativeFee => "negativeFee",
        InvalidLot::TooPrecise => "tooPrecise",
        InvalidLot::TooLarge => "tooLarge",
    }
}

#[sqlx::test(migrations = "../migrations")]
async fn lot_cash_amount_matches_the_shared_cases(pool: PgPool) {
    for c in cases().cash_amount {
        let amount: Decimal = sqlx::query_scalar("select lot_cash_amount($1, $2, $3, $4)")
            .bind(&c.side)
            .bind(c.quantity)
            .bind(c.unit_price)
            .bind(c.fee.unwrap_or_default())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(amount, c.amount, "{}", c.case);
    }
}

#[test]
fn lot_validation_matches_the_shared_cases() {
    let day = NaiveDate::from_ymd_opt(2024, 1, 2).unwrap();
    for c in cases().validation {
        let refused = NewLot::parse(
            LotSide::Buy,
            day,
            &c.quantity,
            &c.unit_price,
            c.fee.as_deref(),
        )
        .err()
        .map(reason);
        assert_eq!(refused, c.refused.as_deref(), "{}", c.case);
    }
}
