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
