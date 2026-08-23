//! Pure mapping: Powens wire models -> gripsou canonical DTOs.

use std::collections::{HashMap, HashSet};

use gripsou_core::dto::{
    CanonicalAccount, CanonicalHolding, CanonicalTransaction, Institution, InstrumentRef,
    SyncResult,
};
use rust_decimal::Decimal;
use serde_json::json;

use crate::powens::model::{BankAccount, Connection, Investment, PowensTransaction};

/// Collapse a Powens `AccountTypeName` onto one of gripsou's seeded
/// `account_type` keys. `None` marks a liability (loan, card):
/// gripsou tracks assets only for now, and mapping these onto an asset type
/// would add their balance to net worth with the wrong sign.
pub fn map_type_key(name: &str) -> Option<&'static str> {
    Some(match name {
        "checking" | "joint" | "deposit" => "checking",
        "savings" | "livret_a" | "livret_b" | "ldds" | "cel" | "csl" | "cat" | "pel" => "savings",
        "pea" => "pea",
        "lifeinsurance" => "life_insurance",
        "per" | "perp" | "pee" | "perco" | "madelin" | "article83" | "rsp" => "retirement",
        "loan" | "card" => return None,
        // Anything unrecognised is assumed to be an invest wrapper. A new
        // liability type would be caught by the arm above once named.
        _ => "brokerage",
    })
}

pub fn is_invest_type(name: &str) -> bool {
    !matches!(
        name,
        "checking"
            | "deposit"
            | "joint"
            | "card"
            | "loan"
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

/// Extract the institution from the connections endpoint. With one connection
/// per token the first connector is correct.
// ponytail: takes the first connector; match by accounts' id_connection if a
// single token ever carries multiple connections.
pub fn map_institution(connections: &[Connection]) -> Institution {
    connections
        .iter()
        .find_map(|c| c.connector.as_ref())
        .map(|c| Institution {
            key: c.uuid.clone().unwrap_or_default(),
            name: c.name.clone().unwrap_or_default(),
        })
        .unwrap_or_default()
}

/// Map a Powens bank account onto a canonical account. The provider-supplied
/// `original_name` seeds the display name (gripsou later preserves user edits);
/// `meta` stashes provider specifics for debugging and the escape hatch.
pub fn map_account(acct: &BankAccount, type_key: &str) -> CanonicalAccount {
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
        type_key: type_key.to_string(),
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

/// Build the cash holding for an account.
///
/// Non-invest accounts always yield a cash holding from `balance` (including a
/// zero balance or a negative overdraft).
///
/// Invest accounts get their cash sleeve from `liquidity`:
/// - `Some(v)` — Powens itemised an `XX-liquidity` sleeve summing to `v`. That
///   is authoritative cash; `balance` is **ignored** because for invest accounts
///   it lags the live investment valuations (observed: a PEA whose `balance`
///   sat below its securities' market value, which would make a residual
///   negative).
/// - `None` — no liquidity sleeve was reported, so fall back to the residual
///   `balance - invested` (covers accounts whose cash is only implied by the
///   balance, e.g. a first sync before investments populate).
///
/// A zero or negative result is dropped, since that cash sleeve would be
/// nonexistent or nonsensical.
fn cash_holding(
    acct: &BankAccount,
    invested: Decimal,
    liquidity: Option<Decimal>,
) -> Option<CanonicalHolding> {
    let balance = acct.balance.unwrap_or(Decimal::ZERO);
    let type_name = acct.r#type.as_deref().unwrap_or("unknown");
    let is_invest = is_invest_type(type_name);

    let quantity = if is_invest {
        let cash = liquidity.unwrap_or(balance - invested);
        if cash <= Decimal::ZERO {
            return None;
        }
        cash
    } else {
        balance
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

/// Top-level mapping: Powens accounts + investments + transactions -> a
/// canonical `SyncResult`.
///
/// Deleted accounts (and their holdings) are skipped; each surviving account
/// contributes its security holdings and a cash holding per `cash_holding`.
///
/// Transactions are filtered here rather than in `map_transactions` because
/// only this function knows which accounts were emitted: `/users/me/transactions`
/// is user-scoped, so it returns rows belonging to the accounts skipped above
/// (a loan, a deferred-debit card, a deleted account). Emitting those would
/// hand the core a dangling `account_external_id`, which is exactly the kind of
/// dangling reference the core is entitled to treat as a bug.
pub fn map_sync(
    accounts: &[BankAccount],
    investments: &[Investment],
    transactions: &[PowensTransaction],
) -> SyncResult {
    let mut by_account: HashMap<i64, Vec<&Investment>> = HashMap::new();
    for inv in investments {
        if inv.deleted.is_none() {
            by_account.entry(inv.id_account).or_default().push(inv);
        }
    }

    // institution is filled by sync() after fetching connections; placeholder here.
    let mut result = SyncResult {
        institution: Institution::default(),
        accounts: Vec::new(),
        holdings: Vec::new(),
        transactions: Vec::new(),
    };
    for acct in accounts {
        if acct.deleted.is_some() {
            continue;
        }
        // A liability maps to no asset type; skip the account entirely so
        // neither it nor its holdings reach the database.
        let Some(type_key) = map_type_key(acct.r#type.as_deref().unwrap_or("unknown")) else {
            continue;
        };
        result.accounts.push(map_account(acct, type_key));

        let account_currency = acct.currency.as_ref().map(|c| c.id.as_str()).unwrap_or("");

        let mut invested = Decimal::ZERO;
        // `None` until a liquidity line is seen, so `cash_holding` can tell
        // "no sleeve reported" apart from "a sleeve worth 0".
        let mut liquidity: Option<Decimal> = None;
        if let Some(invs) = by_account.get(&acct.id) {
            for inv in invs {
                if is_liquidity(inv) {
                    *liquidity.get_or_insert(Decimal::ZERO) +=
                        inv.valuation.unwrap_or(Decimal::ZERO);
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

    let emitted: HashSet<&str> = result
        .accounts
        .iter()
        .map(|a| a.external_id.as_str())
        .collect();
    result.transactions = map_transactions(transactions)
        .into_iter()
        .filter(|t| emitted.contains(t.account_external_id.as_str()))
        .collect();

    result
}

/// Powens appends the card's last four digits to the wording on ~77% of card
/// rows (§2.1). It carries no information the app uses, and it defeats both
/// search and Phase 2 merchant matching.
pub fn strip_card_mask(wording: &str) -> &str {
    let Some(idx) = wording.rfind("CB*") else {
        return wording;
    };
    let tail = &wording[idx + 3..];
    if tail.is_empty() || !tail.chars().all(|c| c.is_ascii_digit()) {
        return wording;
    }
    wording[..idx].trim_end()
}

/// Direction comes from the sign of `value`; the Powens `type` only picks a
/// semantic label the sign cannot express (§6.2). Stated this way because
/// `market_fee` rows were observed carrying positive "INTERETS" values, and
/// Powens warns that new type strings appear without notice.
pub fn map_txn_type(powens_type: Option<&str>, value: Decimal) -> &'static str {
    let negative = value < Decimal::ZERO;
    match powens_type.unwrap_or("") {
        "transfer" | "order" => "transfer",
        "profit" => "dividend",
        "market_fee" => {
            if negative {
                "fee"
            } else {
                "interest"
            }
        }
        "bank" | "fee" => "fee",
        "market_order" => {
            if negative {
                "buy"
            } else {
                "sell"
            }
        }
        _ if negative => "withdrawal",
        _ => "deposit",
    }
}

/// `None` for a row that must not enter the ledger: pending (§6.1), deleted, or
/// missing the two fields the ledger cannot do without.
pub fn map_transaction(t: &PowensTransaction) -> Option<CanonicalTransaction> {
    if t.coming || t.deleted.is_some() {
        return None;
    }
    let value = t.value?;
    let day = t.rdate.or(t.date)?;
    Some(CanonicalTransaction {
        account_external_id: t.id_account.to_string(),
        external_id: t.id.to_string(),
        kind: map_txn_type(t.r#type.as_deref(), value).to_string(),
        ts: day.and_hms_opt(0, 0, 0)?.and_utc(),
        quantity: None,
        unit_price: None,
        amount: value,
        fee: None,
        description: t.wording.as_deref().map(|w| strip_card_mask(w).to_string()),
        provider_meta: serde_json::Value::Object(t.raw.clone()),
    })
}

pub fn map_transactions(txns: &[PowensTransaction]) -> Vec<CanonicalTransaction> {
    txns.iter().filter_map(map_transaction).collect()
}
