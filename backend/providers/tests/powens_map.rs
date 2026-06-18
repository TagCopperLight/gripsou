use gripsou_core::dto::CanonicalHolding;
use gripsou_providers::powens::map;
use gripsou_providers::powens::model::{BankAccount, Investment};
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Deserialize, Default)]
struct Fixture {
    #[serde(default)]
    accounts: Vec<BankAccount>,
    #[serde(default)]
    investments: Vec<Investment>,
}

fn load(name: &str) -> Fixture {
    let path = format!(
        "{}/tests/fixtures/powens/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {path}: {e}"))
}

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

fn account(fx: &Fixture, id: i64) -> &BankAccount {
    fx.accounts
        .iter()
        .find(|a| a.id == id)
        .expect("account in fixture")
}

fn investment(fx: &Fixture, id: i64) -> &Investment {
    fx.investments
        .iter()
        .find(|i| i.id == id)
        .expect("investment in fixture")
}

#[test]
fn maps_account_types_onto_seeded_keys() {
    assert_eq!(map::map_type_key("checking"), "checking");
    for t in [
        "savings", "livret_a", "livret_b", "ldds", "cel", "csl", "cat", "pel", "deposit",
    ] {
        assert_eq!(map::map_type_key(t), "savings", "{t}");
    }
    assert_eq!(map::map_type_key("pea"), "pea");
    assert_eq!(map::map_type_key("market"), "brokerage");
    // Everything else falls back to brokerage, including future/unknown values.
    for t in [
        "lifeinsurance",
        "per",
        "perco",
        "perp",
        "pee",
        "loan",
        "unknown",
        "totally_new",
    ] {
        assert_eq!(map::map_type_key(t), "brokerage", "{t}");
    }
}

#[test]
fn parses_bank_account_decimals_exactly() {
    let fx = load("accounts.json");
    let acct = account(&fx, 1001);
    assert_eq!(acct.balance, Some(dec("1234.56")));
    assert_eq!(acct.currency.as_ref().unwrap().id, "EUR");
    assert_eq!(acct.r#type.as_deref(), Some("checking"));
}

#[test]
fn parses_investment_decimals_exactly() {
    let fx = load("investments.json");
    let inv = investment(&fx, 2001);
    assert_eq!(inv.quantity, Some(dec("10")));
    assert_eq!(inv.unitprice, Some(dec("150.00")));
    assert_eq!(inv.valuation, Some(dec("1600.00")));
    assert_eq!(inv.code_type.as_deref(), Some("ISIN"));
}

#[test]
fn maps_account_identity_and_meta() {
    let fx = load("accounts.json");
    let dto = map::map_account(account(&fx, 1001));
    assert_eq!(dto.external_id, "1001");
    assert_eq!(dto.name, "Compte Courant");
    assert_eq!(dto.type_key, "checking");
    assert_eq!(dto.currency, "EUR");
    assert_eq!(dto.meta["powens_type"], "checking");
    assert_eq!(dto.meta["is_invest"], false);
    assert_eq!(dto.meta["iban"], "FR7612345678901234567890123");
    assert_eq!(dto.meta["id_connection"], 42);
}

#[test]
fn maps_invest_account_type_to_fallback() {
    let fx = load("accounts.json");
    let dto = map::map_account(account(&fx, 1003));
    assert_eq!(dto.type_key, "brokerage");
    assert_eq!(dto.meta["is_invest"], true);
}

#[test]
fn falls_back_to_synthetic_name_when_unnamed() {
    let fx = load("accounts.json");
    let dto = map::map_account(account(&fx, 1004));
    assert_eq!(dto.name, "Account 1004");
}

#[test]
fn maps_isin_investment_ignoring_symbol() {
    let fx = load("investments.json");
    let h = map::map_investment(investment(&fx, 2001), "EUR").expect("holding");
    assert_eq!(h.account_external_id, "1003");
    assert_eq!(h.instrument.kind, "equity");
    assert_eq!(h.instrument.isin.as_deref(), Some("FR0000120073"));
    assert_eq!(h.instrument.symbol, None); // ISIN path drops the ticker
    assert_eq!(h.instrument.name, "Air Liquide");
    assert_eq!(h.instrument.currency, "EUR");
    assert_eq!(h.quantity, dec("10"));
    assert_eq!(h.cost_basis, dec("1500.00")); // 10 * 150.00
    assert_eq!(h.valuation, Some(dec("1600.00")));
}

#[test]
fn maps_amf_investment_to_symbol_path() {
    let fx = load("investments.json");
    // Has a stock_symbol -> symbol comes from stock_symbol.
    let h = map::map_investment(investment(&fx, 2002), "EUR").expect("holding");
    assert_eq!(h.instrument.isin, None);
    assert_eq!(h.instrument.symbol.as_deref(), Some("FEUR"));
    // No stock_symbol -> symbol falls back to the code.
    let h2 = map::map_investment(investment(&fx, 2006), "EUR").expect("holding");
    assert_eq!(h2.instrument.symbol.as_deref(), Some("990000999999"));
}

#[test]
fn investment_currency_follows_original_currency() {
    let fx = load("investments.json");
    let h = map::map_investment(investment(&fx, 2003), "EUR").expect("holding");
    assert_eq!(h.instrument.currency, "USD");
}

#[test]
fn skips_deleted_and_unidentifiable_investments() {
    let fx = load("investments.json");
    assert!(map::map_investment(investment(&fx, 2004), "EUR").is_none()); // deleted
    assert!(map::map_investment(investment(&fx, 2005), "EUR").is_none()); // no identity
}

fn cash_for<'a>(holdings: &'a [CanonicalHolding], account: &str) -> Option<&'a CanonicalHolding> {
    holdings
        .iter()
        .find(|h| h.account_external_id == account && h.instrument.kind == "cash")
}

#[test]
fn non_invest_account_yields_full_balance_cash() {
    let fx = load("accounts.json");
    let result = map::map_sync(&fx.accounts, &fx.investments);
    let cash = cash_for(&result.holdings, "1001").expect("cash holding");
    assert_eq!(cash.quantity, dec("1234.56"));
    assert_eq!(cash.instrument.currency, "EUR");
    assert_eq!(cash.instrument.name, "Euro");
    assert_eq!(cash.cost_basis, dec("1234.56")); // cash carried at par
}

#[test]
fn invest_account_emits_positive_residual_cash() {
    let fx = load("sync_pea_residual.json");
    let result = map::map_sync(&fx.accounts, &fx.investments);
    // 2 securities + 1 residual cash holding.
    assert_eq!(result.holdings.len(), 3);
    let cash = cash_for(&result.holdings, "3001").expect("residual cash");
    assert_eq!(cash.quantity, dec("1000.00")); // 10000 - (4000 + 5000)
}

#[test]
fn fully_invested_account_has_no_cash() {
    let fx = load("sync_fully_invested.json");
    let result = map::map_sync(&fx.accounts, &fx.investments);
    assert_eq!(result.holdings.len(), 2); // securities only
    assert!(cash_for(&result.holdings, "3002").is_none());
}

#[test]
fn zero_and_overdraft_balances_still_emit_cash() {
    let fx = load("sync_cash_variants.json");
    let result = map::map_sync(&fx.accounts, &fx.investments);
    // Deleted account 4003 is skipped entirely.
    assert_eq!(result.accounts.len(), 2);
    assert!(!result.accounts.iter().any(|a| a.external_id == "4003"));
    assert_eq!(
        cash_for(&result.holdings, "4001").unwrap().quantity,
        dec("0")
    );
    assert_eq!(
        cash_for(&result.holdings, "4002").unwrap().quantity,
        dec("-50.00")
    );
}

#[test]
fn map_sync_links_holdings_to_their_accounts() {
    let fx = load("sync_multi.json");
    let result = map::map_sync(&fx.accounts, &fx.investments);
    assert_eq!(result.accounts.len(), 2);
    // checking cash (2000) + security (5000) + residual cash (1000) = 3 holdings.
    assert_eq!(result.holdings.len(), 3);
    // The security belongs to the brokerage account.
    let security = result
        .holdings
        .iter()
        .find(|h| h.instrument.kind == "equity")
        .expect("security");
    assert_eq!(security.account_external_id, "5002");
    assert_eq!(
        cash_for(&result.holdings, "5001").unwrap().quantity,
        dec("2000.00")
    );
    assert_eq!(
        cash_for(&result.holdings, "5002").unwrap().quantity,
        dec("1000.00")
    );
    // Every holding references a real mapped account.
    let ids: Vec<&str> = result
        .accounts
        .iter()
        .map(|a| a.external_id.as_str())
        .collect();
    assert!(
        result
            .holdings
            .iter()
            .all(|h| ids.contains(&h.account_external_id.as_str()))
    );
    // market -> brokerage.
    let brokerage = result
        .accounts
        .iter()
        .find(|a| a.external_id == "5002")
        .unwrap();
    assert_eq!(brokerage.type_key, "brokerage");
}
