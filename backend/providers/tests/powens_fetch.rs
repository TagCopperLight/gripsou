use gripsou_providers::powens::PowensProvider;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Powens caps `limit` at 1000 and paginates via `_links.next`; a 3.5-year
/// history is several pages, so a fetch that stops at page one silently loses
/// most of the ledger.
#[tokio::test]
async fn follows_the_next_link_to_exhaustion() {
    let server = MockServer::start().await;

    // Account 501 must exist: map_sync only emits transactions whose account it
    // also emitted, so an empty account list would filter both pages away and
    // this test would pass vacuously while proving nothing about pagination.
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/accounts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "accounts": [{
                "id": 501,
                "name": "Compte courant",
                "balance": 100.0,
                "type": "checking",
                "currency": { "id": "EUR" }
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/investments"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"investments": []})),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/connections"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"connections": []})),
        )
        .mount(&server)
        .await;

    let page2 = format!(
        "{}/2.0/users/me/transactions?limit=1000&offset=1",
        server.uri()
    );
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/transactions"))
        .and(query_param("offset", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "transactions": [{
                "id": 2, "id_account": 501, "rdate": "2026-01-02", "date": "2026-01-02",
                "value": -2.0, "wording": "TWO", "type": "card", "coming": false, "deleted": null
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/transactions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "transactions": [{
                "id": 1, "id_account": 501, "rdate": "2026-01-01", "date": "2026-01-01",
                "value": -1.0, "wording": "ONE", "type": "card", "coming": false, "deleted": null
            }],
            "_links": { "next": { "href": page2 } }
        })))
        .mount(&server)
        .await;

    let provider = PowensProvider::for_test(&server.uri());
    let result = gripsou_core::provider::AccountProvider::sync(
        &provider,
        &serde_json::json!({ "auth_token": "t" }),
    )
    .await
    .expect("sync");

    let ids: Vec<&str> = result
        .transactions
        .iter()
        .map(|t| t.external_id.as_str())
        .collect();
    assert_eq!(ids, vec!["1", "2"], "both pages are ingested");
}

/// Mounts the two list endpoints `sync` needs besides the one under test, plus
/// an empty connections response, so a test can speak about one endpoint only.
async fn mount_empty_except(server: &MockServer, skip: &[&str]) {
    for (p, body) in [
        (
            "/2.0/users/me/accounts",
            serde_json::json!({"accounts": []}),
        ),
        (
            "/2.0/users/me/investments",
            serde_json::json!({"investments": []}),
        ),
        (
            "/2.0/users/me/transactions",
            serde_json::json!({"transactions": []}),
        ),
        (
            "/2.0/users/me/connections",
            serde_json::json!({"connections": []}),
        ),
    ] {
        if skip.contains(&p) {
            continue;
        }
        Mock::given(method("GET"))
            .and(path(p))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }
}

fn checking_account(id: i64) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": format!("Compte {id}"),
        "balance": 1.0,
        "type": "checking",
        "currency": { "id": "EUR" }
    })
}

/// `/accounts` and `/investments` document `limit`/`offset` and no cursor, so a
/// full page with no `_links.next` means "there is probably more" — not "that
/// is all there is". Stopping there would hand the ingest a short holding list,
/// which it reads as "those positions were sold" and zeroes (C-4).
#[tokio::test]
async fn a_full_account_page_without_a_cursor_is_followed_by_offset() {
    let server = MockServer::start().await;
    mount_empty_except(&server, &["/2.0/users/me/accounts"]).await;

    let page1: Vec<serde_json::Value> = (1..=1000).map(checking_account).collect();
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/accounts"))
        .and(query_param("offset", "1000"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "accounts": [checking_account(1001)]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/accounts"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({ "accounts": page1 })),
        )
        .mount(&server)
        .await;

    let provider = PowensProvider::for_test(&server.uri());
    let result = gripsou_core::provider::AccountProvider::sync(
        &provider,
        &serde_json::json!({ "auth_token": "t" }),
    )
    .await
    .expect("sync");

    assert_eq!(result.accounts.len(), 1001, "both pages are ingested");
}

/// The investments endpoint gets the same treatment, and honours a cursor when
/// the response does carry one.
#[tokio::test]
async fn investments_follow_the_next_link() {
    let server = MockServer::start().await;
    mount_empty_except(
        &server,
        &["/2.0/users/me/investments", "/2.0/users/me/accounts"],
    )
    .await;

    // The holdings need an account to hang off, or map_sync drops them and the
    // assertion below would pass without proving anything.
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/accounts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "accounts": [{
                "id": 501, "name": "PEA", "balance": 100.0,
                "type": "market", "currency": { "id": "EUR" }
            }]
        })))
        .mount(&server)
        .await;

    let page2 = format!(
        "{}/2.0/users/me/investments?limit=1000&offset=1",
        server.uri()
    );
    let inv = |id: i64, isin: &str| {
        serde_json::json!({
            "id": id, "id_account": 501, "label": format!("Fund {id}"),
            "code": isin, "code_type": "ISIN", "quantity": 1.0,
            "unitprice": 10.0, "unitvalue": 12.0, "valuation": 12.0
        })
    };
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/investments"))
        .and(query_param("offset", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "investments": [inv(2, "FR0000000002")]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/investments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "investments": [inv(1, "FR0000000001")],
            "_links": { "next": { "href": page2 } }
        })))
        .mount(&server)
        .await;

    let provider = PowensProvider::for_test(&server.uri());
    let result = gripsou_core::provider::AccountProvider::sync(
        &provider,
        &serde_json::json!({ "auth_token": "t" }),
    )
    .await
    .expect("sync");

    let isins: Vec<&str> = result
        .holdings
        .iter()
        .filter_map(|h| h.instrument.isin.as_deref())
        .collect();
    assert_eq!(isins, vec!["FR0000000001", "FR0000000002"]);
}

/// A cursor that never advances must fail the sync, not hand the ingest the
/// rows gathered so far: a partial holding list is worse than no sync at all,
/// because the ingest zeroes every holding it does not see and writes that
/// zero into the snapshot history.
#[tokio::test]
async fn a_cursor_that_never_ends_fails_the_sync() {
    let server = MockServer::start().await;
    mount_empty_except(&server, &["/2.0/users/me/accounts"]).await;

    let forever = format!("{}/2.0/users/me/accounts?limit=1000", server.uri());
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/accounts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "accounts": [checking_account(1)],
            "_links": { "next": { "href": forever } }
        })))
        .mount(&server)
        .await;

    let provider = PowensProvider::for_test(&server.uri());
    let err = gripsou_core::provider::AccountProvider::sync(
        &provider,
        &serde_json::json!({ "auth_token": "t" }),
    )
    .await
    .expect_err("a non-terminating pagination must not resolve to a partial sync");
    assert!(
        format!("{err:?}").contains("did not terminate"),
        "unexpected error: {err:?}"
    );
}
