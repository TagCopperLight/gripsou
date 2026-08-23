use gripsou_core::dto::CanonicalHolding;
use gripsou_providers::powens::map;
use gripsou_providers::powens::model::{BankAccount, Connection, Investment, PowensTransaction};
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Deserialize, Default)]
struct Fixture {
    #[serde(default)]
    accounts: Vec<BankAccount>,
    #[serde(default)]
    investments: Vec<Investment>,
    #[serde(default)]
    connections: Vec<Connection>,
    #[serde(default)]
    transactions: Vec<PowensTransaction>,
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
    for t in ["checking", "joint", "deposit"] {
        assert_eq!(map::map_type_key(t), Some("checking"), "{t}");
    }
    for t in [
        "savings", "livret_a", "livret_b", "ldds", "cel", "csl", "cat", "pel",
    ] {
        assert_eq!(map::map_type_key(t), Some("savings"), "{t}");
    }
    assert_eq!(map::map_type_key("pea"), Some("pea"));
    for t in ["market", "capitalisation", "crowdlending"] {
        assert_eq!(map::map_type_key(t), Some("brokerage"), "{t}");
    }
    assert_eq!(map::map_type_key("lifeinsurance"), Some("life_insurance"));
    for t in ["per", "perp", "pee", "perco", "madelin", "article83", "rsp"] {
        assert_eq!(map::map_type_key(t), Some("retirement"), "{t}");
    }
    // Unknown values are assumed to be some new invest wrapper.
    for t in ["unknown", "totally_new"] {
        assert_eq!(map::map_type_key(t), Some("brokerage"), "{t}");
    }
}

#[test]
fn liability_types_are_not_mapped() {
    for t in ["loan", "card"] {
        assert_eq!(map::map_type_key(t), None, "{t}");
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
    let dto = map::map_account(account(&fx, 1001), "checking");
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
fn maps_invest_account_meta() {
    let fx = load("accounts.json");
    // Fixture account 1003 has powens type "per", which maps onto the seeded
    // "retirement" key. The load-bearing assertion here is that its meta
    // flags it as an invest account.
    let dto = map::map_account(account(&fx, 1003), "retirement");
    assert_eq!(dto.type_key, "retirement");
    assert_eq!(dto.meta["is_invest"], true);
}

#[test]
fn falls_back_to_synthetic_name_when_unnamed() {
    let fx = load("accounts.json");
    let dto = map::map_account(account(&fx, 1004), "checking");
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

#[test]
fn skips_powens_liquidity_pseudo_instrument() {
    // Powens reports an investment account's un-invested cash sleeve as an
    // investment with code "XX-liquidity". It is cash, not a security, so it is
    // dropped here and folds into the account's cash residual instead.
    let fx = load("sync_liquidity.json");
    assert!(map::map_investment(investment(&fx, 6102), "EUR").is_none());
}

#[test]
fn liquidity_line_is_the_invest_account_cash() {
    let fx = load("sync_liquidity.json");
    let result = map::map_sync(&fx.accounts, &fx.investments, &fx.transactions);
    // One real security + one cash holding; no separate "Liquidités" line.
    assert_eq!(result.holdings.len(), 2);
    assert!(
        !result
            .holdings
            .iter()
            .any(|h| h.instrument.name == "Liquidités"),
        "the liquidity pseudo-instrument must not appear as a holding"
    );
    // The liquidity sleeve (50) is the cash; the account's `balance` (1000) is
    // ignored for invest accounts because it lags the live valuations.
    let cash = cash_for(&result.holdings, "6001").expect("cash sleeve");
    assert_eq!(cash.quantity, dec("50"));
}

fn cash_for<'a>(holdings: &'a [CanonicalHolding], account: &str) -> Option<&'a CanonicalHolding> {
    holdings
        .iter()
        .find(|h| h.account_external_id == account && h.instrument.kind == "cash")
}

#[test]
fn map_institution_reads_first_connector() {
    let fx = load("connections.json");
    let inst = map::map_institution(&fx.connections);
    assert_eq!(inst.key, "abc-uuid-bnp");
    assert_eq!(inst.name, "BNP Paribas");
}

#[test]
fn map_institution_empty_when_no_connector() {
    let inst = map::map_institution(&[]);
    assert_eq!(inst.key, "");
    assert_eq!(inst.name, "");
}

#[test]
fn non_invest_account_yields_full_balance_cash() {
    let fx = load("accounts.json");
    let result = map::map_sync(&fx.accounts, &fx.investments, &fx.transactions);
    let cash = cash_for(&result.holdings, "1001").expect("cash holding");
    assert_eq!(cash.quantity, dec("1234.56"));
    assert_eq!(cash.instrument.currency, "EUR");
    assert_eq!(cash.instrument.name, "Euro");
    assert_eq!(cash.cost_basis, dec("1234.56")); // cash carried at par
}

#[test]
fn invest_account_emits_positive_residual_cash() {
    let fx = load("sync_pea_residual.json");
    let result = map::map_sync(&fx.accounts, &fx.investments, &fx.transactions);
    // 2 securities + 1 residual cash holding.
    assert_eq!(result.holdings.len(), 3);
    let cash = cash_for(&result.holdings, "3001").expect("residual cash");
    assert_eq!(cash.quantity, dec("1000.00")); // 10000 - (4000 + 5000)
}

#[test]
fn fully_invested_account_has_no_cash() {
    let fx = load("sync_fully_invested.json");
    let result = map::map_sync(&fx.accounts, &fx.investments, &fx.transactions);
    assert_eq!(result.holdings.len(), 2); // securities only
    assert!(cash_for(&result.holdings, "3002").is_none());
}

#[test]
fn zero_and_overdraft_balances_still_emit_cash() {
    let fx = load("sync_cash_variants.json");
    let result = map::map_sync(&fx.accounts, &fx.investments, &fx.transactions);
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
    let result = map::map_sync(&fx.accounts, &fx.investments, &fx.transactions);
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

#[test]
fn map_sync_skips_liability_account_and_its_holdings() {
    // Fixture account 5003 is a "loan" (liability); it has one investment
    // (id 5102, id_account 5003) attached. Skipping the account must also
    // skip that holding, not just omit the account row.
    let fx = load("sync_multi.json");
    let result = map::map_sync(&fx.accounts, &fx.investments, &fx.transactions);
    assert!(
        !result.accounts.iter().any(|a| a.external_id == "5003"),
        "liability account must not be mapped"
    );
    assert!(
        !result
            .holdings
            .iter()
            .any(|h| h.account_external_id == "5003"),
        "holdings of a skipped liability account must not be mapped"
    );
    // The loan's own investment (5102) specifically must not appear.
    assert!(
        !result
            .holdings
            .iter()
            .any(|h| h.instrument.isin.as_deref() == Some("FR0000999999")),
        "the loan account's investment must not be mapped as a holding"
    );
}

fn mapped_txns() -> Vec<gripsou_core::dto::CanonicalTransaction> {
    map::map_transactions(&load("transactions.json").transactions)
}

fn by_id(
    txns: &[gripsou_core::dto::CanonicalTransaction],
    id: &str,
) -> gripsou_core::dto::CanonicalTransaction {
    txns.iter()
        .find(|t| t.external_id == id)
        .expect("mapped transaction")
        .clone()
}

#[test]
fn strips_the_trailing_card_mask_from_the_description() {
    let t = by_id(&mapped_txns(), "1001");
    assert_eq!(t.description.as_deref(), Some("LECLERC"));
    // A wording that is *only* a mask leaves an empty description, not "CB*1234".
    let bare = by_id(&mapped_txns(), "1012");
    assert_eq!(bare.description.as_deref(), Some(""));
}

#[test]
fn prefers_rdate_and_falls_back_to_date() {
    let txns = mapped_txns();
    assert_eq!(
        by_id(&txns, "1001").ts.date_naive().to_string(),
        "2026-03-14"
    );
    assert_eq!(
        by_id(&txns, "1002").ts.date_naive().to_string(),
        "2026-03-10"
    );
}

#[test]
fn maps_types_by_sign_not_by_label() {
    let txns = mapped_txns();
    assert_eq!(by_id(&txns, "1002").kind, "transfer");
    assert_eq!(by_id(&txns, "1003").kind, "dividend", "profit -> dividend");
    assert_eq!(by_id(&txns, "1004").kind, "buy", "negative market_order");
    assert_eq!(by_id(&txns, "1005").kind, "sell", "positive market_order");
    // The label lies: a positive market_fee is interest, not a fee (§2.1).
    assert_eq!(by_id(&txns, "1006").kind, "interest");
    assert_eq!(by_id(&txns, "1007").kind, "fee");
    // Unknown/novel types fall back to the sign of `value`.
    assert_eq!(by_id(&txns, "1008").kind, "deposit");
    assert_eq!(by_id(&txns, "1009").kind, "withdrawal");
}

#[test]
fn drops_pending_and_deleted_rows() {
    let txns = mapped_txns();
    assert!(
        txns.iter().all(|t| t.external_id != "1010"),
        "coming = true is excluded (§6.1)"
    );
    assert!(
        txns.iter().all(|t| t.external_id != "1011"),
        "deleted rows are excluded"
    );
}

#[test]
fn carries_amount_and_account_link_verbatim() {
    let t = by_id(&mapped_txns(), "1004");
    assert_eq!(t.amount, dec("-320.58"));
    assert_eq!(t.account_external_id, "502");
    // Powens links no instrument to a market_order row (§2.1): no ISIN, no
    // id_security, empty `informations`. The user fills that in (§9).
    assert!(t.quantity.is_none() && t.unit_price.is_none());
}

#[test]
fn carries_the_raw_payload_in_provider_meta() {
    // A future refactor that stops threading the raw row through must fail
    // here: `id_account` has its own canonical column, but the raw copy in
    // `provider_meta` must still be present verbatim (§4, §6.2).
    let t = by_id(&mapped_txns(), "1004");
    assert!(
        !t.provider_meta.as_object().unwrap().is_empty(),
        "provider_meta must not be empty"
    );
    assert_eq!(t.provider_meta["id_account"], 502);
    assert_eq!(t.provider_meta["type"], "market_order");
}

#[test]
fn maps_the_remaining_powens_type_labels() {
    // §6.2's mapping table, the rows the earlier fixture never exercised.
    let txns = mapped_txns();
    assert_eq!(by_id(&txns, "1013").kind, "transfer", "order -> transfer");
    assert_eq!(by_id(&txns, "1014").kind, "fee", "bank -> fee");
    assert_eq!(by_id(&txns, "1015").kind, "fee", "fee -> fee");
}

#[test]
fn a_zero_value_is_not_negative() {
    // §6.2 splits on `< 0` / `>= 0`: zero belongs to the non-negative side of
    // every sign-dependent arm. Locked so a refactor to `<=` fails here.
    let txns = mapped_txns();
    assert_eq!(by_id(&txns, "1016").kind, "deposit", "unknown type, 0");
    assert_eq!(by_id(&txns, "1017").kind, "sell", "market_order, 0");
    assert_eq!(by_id(&txns, "1018").kind, "interest", "market_fee, 0");
}

#[test]
fn map_sync_drops_transactions_of_accounts_it_did_not_emit() {
    // `GET /users/me/transactions` is user-scoped, so it returns rows for
    // accounts `map_sync` deliberately skips (liability, deleted). Emitting
    // them would hand the core a dangling account reference and abort the
    // whole ingest transaction.
    let fx = load("sync_multi.json");
    let result = map::map_sync(&fx.accounts, &fx.investments, &fx.transactions);

    let emitted: Vec<&str> = result
        .accounts
        .iter()
        .map(|a| a.external_id.as_str())
        .collect();
    assert!(
        result
            .transactions
            .iter()
            .all(|t| emitted.contains(&t.account_external_id.as_str())),
        "every emitted transaction must reference an emitted account"
    );
    // The kept one, on the checking account, is still there.
    assert!(
        result.transactions.iter().any(|t| t.external_id == "9001"),
        "a transaction on a mapped account must survive"
    );
    for (id, why) in [
        ("9002", "loan account"),
        ("9003", "card account"),
        ("9004", "deleted account"),
    ] {
        assert!(
            !result.transactions.iter().any(|t| t.external_id == id),
            "transaction {id} on a skipped {why} must not be emitted"
        );
    }
}

/// §6.2 keys `ts` on `rdate` because it is 100% filled — but the *balance*
/// follows the booking date, and the two disagree on 70% of real rows by up to
/// five days. `ts` stays the day the card was tapped (what the user recognises
/// on the list); `booked_on` carries the day the money actually moved, which is
/// the only date the backward walk can honestly use.
#[test]
fn carries_both_the_spend_date_and_the_booking_date() {
    let txns = mapped_txns();
    let t = by_id(&txns, "1019");
    assert_eq!(t.ts.date_naive().to_string(), "2026-08-14", "ts is rdate");
    assert_eq!(
        t.booked_on.map(|d| d.to_string()).as_deref(),
        Some("2026-08-17"),
        "booked_on is the booking date"
    );
}

#[test]
fn falls_back_to_the_booking_date_when_rdate_is_absent() {
    let t = by_id(&mapped_txns(), "1020");
    assert_eq!(t.ts.date_naive().to_string(), "2026-08-19");
    assert_eq!(
        t.booked_on.map(|d| d.to_string()).as_deref(),
        Some("2026-08-19")
    );
}
