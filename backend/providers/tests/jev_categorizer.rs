use chrono::NaiveDate;
use gripsou_core::categorize::{
    CategorizeError, CategorizeItem, CategorizeRequest, Categorizer, CategoryOption, Example,
};
use gripsou_providers::jev::JevCategorizer;
use rust_decimal::Decimal;
use uuid::Uuid;
use wiremock::matchers::{body_string_contains, header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const GROCERIES: &str = "11111111-1111-1111-1111-111111111111";
const IGNORE: &str = "22222222-2222-2222-2222-222222222222";

fn request(descs: &[&str]) -> CategorizeRequest {
    let groceries = Uuid::parse_str(GROCERIES).unwrap();
    let ignore = Uuid::parse_str(IGNORE).unwrap();
    CategorizeRequest {
        categories: vec![
            CategoryOption {
                id: groceries,
                name: "Groceries".into(),
                kind: "expense".into(),
                hint: Some("supermarkets".into()),
            },
            CategoryOption {
                id: ignore,
                name: "Ignore".into(),
                kind: "excluded".into(),
                hint: None,
            },
        ],
        shared_examples: vec![],
        items: descs
            .iter()
            .enumerate()
            .map(|(n, d)| CategorizeItem {
                key: Uuid::from_u128(n as u128 + 1),
                description: (*d).into(),
                amount: Decimal::new(-1250, 2),
                currency: "EUR".into(),
                account_type: "checking".into(),
                date: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
                candidates: vec![groceries, ignore],
                examples: vec![Example {
                    description: "LECLERC 0412".into(),
                    amount: Decimal::new(-3000, 2),
                    currency: "EUR".into(),
                    account_type: "checking".into(),
                    date: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
                    category_id: groceries,
                }],
            })
            .collect(),
    }
}

fn answer(choice: &str, confidence: f64) -> serde_json::Value {
    serde_json::json!({
        "model": "jev-1.13.0",
        "answers": { "category": { "type": "choice", "choice": choice, "confidence": confidence,
                                   "probabilities": {} } },
        "usage": { "input_tokens": 300, "output_tokens": 30 }
    })
}

#[tokio::test]
async fn one_choice_request_per_item_keyed_by_candidate_ids() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/systemone"))
        .and(header("authorization", "Bearer k"))
        .respond_with(ResponseTemplate::new(200).set_body_json(answer(GROCERIES, 0.9)))
        .mount(&server)
        .await;
    let j = JevCategorizer::new("k".into(), "jev-latest".into()).with_base_url(server.uri());

    let out = j
        .categorize(&request(&["LECLERC 0999", "LECLERC 0998"]))
        .await
        .unwrap();

    let received: Vec<Request> = server.received_requests().await.unwrap();
    assert_eq!(received.len(), 2);
    let body: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
    let criteria = body["questions"]["category"]["criteria"]
        .as_object()
        .unwrap();
    assert!(criteria.contains_key(GROCERIES));
    assert!(criteria.contains_key(IGNORE));
    assert!(criteria.contains_key("none"));
    assert!(
        criteria[GROCERIES]
            .as_str()
            .unwrap()
            .contains("supermarkets")
    );
    assert_eq!(body["questions"]["category"]["type"], "choice");
    let state = body["state"].as_str().unwrap();
    assert!(state.contains("LECLERC"));
    assert!(
        state.contains("Groceries"),
        "examples are rendered with category names"
    );

    assert_eq!(out.guesses.len(), 2);
    assert_eq!(
        out.guesses[0].category_id,
        Some(Uuid::parse_str(GROCERIES).unwrap())
    );
    assert_eq!(out.guesses[0].confidence, Some(Decimal::new(9, 1)));
    assert_eq!(out.tokens_in, Some(600));
    assert_eq!(out.tokens_out, Some(60));
}

#[tokio::test]
async fn none_is_an_abstention() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(answer("none", 0.7)))
        .mount(&server)
        .await;
    let j = JevCategorizer::new("k".into(), "m".into()).with_base_url(server.uri());
    let out = j.categorize(&request(&["???"])).await.unwrap();
    assert_eq!(out.guesses[0].category_id, None);
}

#[tokio::test]
async fn one_rate_limited_item_fails_the_batch() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_string_contains("BAD"))
        .respond_with(ResponseTemplate::new(429))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(answer(GROCERIES, 0.9)))
        .mount(&server)
        .await;
    let j = JevCategorizer::new("k".into(), "m".into()).with_base_url(server.uri());
    assert!(matches!(
        j.categorize(&request(&["OK", "BAD", "OK"])).await,
        Err(CategorizeError::RateLimited)
    ));
}

#[tokio::test]
async fn a_server_error_is_other() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(500).set_body_string("boom"))
        .mount(&server)
        .await;
    let j = JevCategorizer::new("k".into(), "m".into()).with_base_url(server.uri());
    assert!(matches!(
        j.categorize(&request(&["X"])).await,
        Err(CategorizeError::Other(_))
    ));
}
