//! Pure mapping: Powens wire models -> gripsou canonical DTOs.

use std::collections::HashMap;

use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef, SyncResult};
use rust_decimal::Decimal;
use serde_json::json;

use crate::powens::model::{BankAccount, Investment};

/// Collapse a Powens `AccountTypeName` onto one of gripsou's seeded
/// `account_type` keys. Total: any unrecognized value falls back to `brokerage`.
pub fn map_type_key(name: &str) -> &'static str {
    match name {
        "checking" => "checking",
        "savings" | "livret_a" | "livret_b" | "ldds" | "cel" | "csl" | "cat" | "pel"
        | "deposit" => "savings",
        "pea" => "pea",
        _ => "brokerage",
    }
}

pub fn is_invest_type(name: &str) -> bool {
    !matches!(
        name,
        "checking"
            | "deposit"
            | "joint"
            | "card"
            | "deferred_card"
            | "loan"
            | "mortgage"
            | "consumercredit"
            | "savings"
            | "livret_a"
            | "livret_b"
            | "ldds"
            | "cel"
            | "csl"
            | "cat"
            | "pel"
    )
}

/// Powens reports an investment account's un-invested cash sleeve as an
/// investment carrying the pseudo-code `XX-liquidity`. It is cash, not a
/// security; it's mapped into the account's cash holding rather than shown as
/// its own line.
pub fn is_liquidity(inv: &Investment) -> bool {
    inv.code.as_deref() == Some("XX-liquidity")
        || inv.stock_symbol.as_deref() == Some("XX-liquidity")
}

/// Map a Powens bank account onto a canonical account. The provider-supplied
/// `original_name` seeds the display name (gripsou later preserves user edits);
/// `meta` stashes provider specifics for debugging and the escape hatch.
pub fn map_account(acct: &BankAccount) -> CanonicalAccount {
    let type_name = acct.r#type.as_deref().unwrap_or("unknown");
    let is_invest = is_invest_type(type_name);

    let currency = acct
        .currency
        .as_ref()
        .map(|c| c.id.clone())
        .unwrap_or_default();
    let name = acct
        .original_name
        .clone()
        .or_else(|| acct.name.clone())
        .unwrap_or_else(|| format!("Account {}", acct.id));

    CanonicalAccount {
        external_id: acct.id.to_string(),
        name,
        type_key: map_type_key(type_name).to_string(),
        currency,
        meta: json!({
            "powens_type": type_name,
            "is_invest": is_invest,
            "iban": acct.iban,
            "number": acct.number,
            "id_connection": acct.id_connection,
        }),
    }
}

fn instrument_currency(inv: &Investment, account_currency: &str) -> String {
    inv.original_currency
        .as_ref()
        .map(|c| c.id.clone())
        .unwrap_or_else(|| account_currency.to_string())
}

/// Map a single Powens investment to a canonical security holding. Returns
/// `None` when the investment is deleted or carries no usable instrument
/// identity (no ISIN, ticker, or code). `kind` is a generic `equity` because
/// Powens does not reliably distinguish equities from ETFs/funds; the core
/// dedups securities by ISIN, so this is harmless on the common path.
pub fn map_investment(inv: &Investment, account_currency: &str) -> Option<CanonicalHolding> {
    if inv.deleted.is_some() {
        return None;
    }

    // The liquidity sleeve is cash, not a security; `map_sync` folds its value
    // into the account's cash holding instead (see `is_liquidity`).
    if is_liquidity(inv) {
        return None;
    }

    let (isin, symbol) = match (inv.code_type.as_deref(), inv.code.as_deref()) {
        (Some("ISIN"), Some(code)) => (Some(code.to_string()), None),
        _ => (None, inv.stock_symbol.clone().or_else(|| inv.code.clone())),
    };
    if isin.is_none() && symbol.is_none() {
        return None;
    }

    let quantity = inv.quantity.unwrap_or(Decimal::ZERO);
    let unitprice = inv.unitprice.unwrap_or(Decimal::ZERO);

    Some(CanonicalHolding {
        account_external_id: inv.id_account.to_string(),
        instrument: InstrumentRef {
            kind: "equity".to_string(),
            symbol,
            isin,
            name: inv
                .label
                .clone()
                .unwrap_or_else(|| format!("Investment {}", inv.id)),
            currency: instrument_currency(inv, account_currency),
        },
        quantity,
        cost_basis: quantity * unitprice,
        valuation: inv.valuation,
    })
}

/// Build the cash holding for an account, given the summed valuation of the
/// security holdings (`invested`) and of any `XX-liquidity` sleeve (`liquidity`)
/// booked against it. Non-invest accounts always yield a cash holding (including
/// a zero balance or a negative overdraft). Invest accounts yield the positive
/// residual (`balance - invested + liquidity`); a zero or negative result is
/// dropped, since that cash sleeve would be nonexistent or nonsensical.
///
/// Powens reports an investment account's `balance` as its securities value and
/// itemises the cash separately as the liquidity sleeve, so `liquidity` is added
/// on top of the residual rather than being netted out of `balance`.
fn cash_holding(
    acct: &BankAccount,
    invested: Decimal,
    liquidity: Decimal,
) -> Option<CanonicalHolding> {
    let balance = acct.balance.unwrap_or(Decimal::ZERO);
    let type_name = acct.r#type.as_deref().unwrap_or("unknown");
    let is_invest = is_invest_type(type_name);

    let quantity = if is_invest {
        let residual = balance - invested + liquidity;
        if residual <= Decimal::ZERO {
            return None;
        }
        residual
    } else {
        balance + liquidity
    };

    let currency = acct
        .currency
        .as_ref()
        .map(|c| c.id.clone())
        .unwrap_or_default();
    let cash_name = acct
        .currency
        .as_ref()
        .and_then(|c| c.name.clone())
        .unwrap_or_else(|| currency.clone());

    Some(CanonicalHolding {
        account_external_id: acct.id.to_string(),
        instrument: InstrumentRef {
            kind: "cash".to_string(),
            symbol: None,
            isin: None,
            name: cash_name,
            currency,
        },
        quantity,
        cost_basis: quantity,
        valuation: Some(quantity),
    })
}

/// Top-level mapping: Powens accounts + investments -> a canonical `SyncResult`.
/// Deleted accounts (and their holdings) are skipped; each surviving account
/// contributes its security holdings and a cash holding per `cash_holding`.
pub fn map_sync(accounts: &[BankAccount], investments: &[Investment]) -> SyncResult {
    let mut by_account: HashMap<i64, Vec<&Investment>> = HashMap::new();
    for inv in investments {
        if inv.deleted.is_none() {
            by_account.entry(inv.id_account).or_default().push(inv);
        }
    }

    let mut result = SyncResult::default();
    for acct in accounts {
        if acct.deleted.is_some() {
            continue;
        }
        result.accounts.push(map_account(acct));

        let account_currency = acct.currency.as_ref().map(|c| c.id.as_str()).unwrap_or("");

        let mut invested = Decimal::ZERO;
        let mut liquidity = Decimal::ZERO;
        if let Some(invs) = by_account.get(&acct.id) {
            for inv in invs {
                if is_liquidity(inv) {
                    liquidity += inv.valuation.unwrap_or(Decimal::ZERO);
                    continue;
                }
                if let Some(holding) = map_investment(inv, account_currency) {
                    invested += holding.valuation.unwrap_or(Decimal::ZERO);
                    result.holdings.push(holding);
                }
            }
        }

        if let Some(cash) = cash_holding(acct, invested, liquidity) {
            result.holdings.push(cash);
        }
    }
    result
}
