//! Gemini `generateContent` JSON ↔ the canonical categorisation DTOs.

use std::collections::BTreeSet;
use std::str::FromStr;

use gripsou_core::categorize::{
    CategorizeError, CategorizeOutput, CategorizeRequest, Example, Guess, Merchant,
};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use uuid::Uuid;

pub const SYSTEM_PROMPT: &str = "You categorise personal bank transactions for a budgeting app. \
Descriptions are raw French bank wordings (card payments, transfers, direct debits). \
A negative amount is money going out; a positive amount is money coming in. \
For each item, choose exactly one category id from that item's `allowed` list, or null when none fits. \
Never use an id that is not in the item's `allowed` list. \
Use the confirmed examples: they are the user's own past decisions, and the amount, date and account \
often distinguish transactions that share a description. \
Give a confidence between 0 and 1 that reflects how sure you are. \
When the merchant is recognisable, give its name and its main web domain (e.g. leclerc.fr), else null. \
Answer with one entry per item, keyed by the item's index `i`.";

fn example_json(req: &CategorizeRequest, e: &Example) -> Value {
    json!({
        "description": e.description,
        "amount": e.amount.to_string(),
        "currency": e.currency,
        "account_type": e.account_type,
        "date": e.date.to_string(),
        "category": req.category_name(e.category_id).unwrap_or("?"),
        "category_id": e.category_id.to_string(),
    })
}

/// The user turn: one JSON document. Item indices, never transaction ids.
pub fn user_text(req: &CategorizeRequest) -> String {
    let doc = json!({
        "categories": req.categories.iter().map(|c| json!({
            "id": c.id.to_string(), "name": c.name, "kind": c.kind, "hint": c.hint,
        })).collect::<Vec<_>>(),
        "recent_corrections": req.shared_examples.iter().map(|e| example_json(req, e)).collect::<Vec<_>>(),
        "items": req.items.iter().enumerate().map(|(i, it)| json!({
            "i": i,
            "description": it.description,
            "amount": it.amount.to_string(),
            "currency": it.currency,
            "account_type": it.account_type,
            "date": it.date.to_string(),
            "allowed": it.candidates.iter().map(Uuid::to_string).collect::<Vec<_>>(),
            "examples": it.examples.iter().map(|e| example_json(req, e)).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    });
    doc.to_string()
}

/// `responseSchema` (OpenAPI subset). The enum is the union of every item's
/// candidates; the per-item check is still the core's (`budget::ai::decide`).
pub fn response_schema(req: &CategorizeRequest) -> Value {
    let ids: BTreeSet<String> = req
        .items
        .iter()
        .flat_map(|it| it.candidates.iter().map(Uuid::to_string))
        .collect();
    let mut category_id = json!({ "type": "STRING", "nullable": true });
    if !ids.is_empty() {
        category_id["enum"] = json!(ids.into_iter().collect::<Vec<_>>());
    }
    json!({
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "i": { "type": "INTEGER" },
                "category_id": category_id,
                "confidence": { "type": "NUMBER" },
                "merchant": {
                    "type": "OBJECT",
                    "nullable": true,
                    "properties": {
                        "name": { "type": "STRING", "nullable": true },
                        "domain": { "type": "STRING", "nullable": true }
                    }
                }
            },
            "required": ["i", "category_id", "confidence"]
        }
    })
}

pub fn build_body(req: &CategorizeRequest) -> Value {
    json!({
        "systemInstruction": { "parts": [{ "text": SYSTEM_PROMPT }] },
        "contents": [{ "role": "user", "parts": [{ "text": user_text(req) }] }],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": response_schema(req),
        }
    })
}

fn decimal_of(v: &Value) -> Option<Decimal> {
    match v {
        Value::Number(n) => Decimal::from_str(&n.to_string())
            .or_else(|_| Decimal::from_scientific(&n.to_string()))
            .ok(),
        Value::String(s) => Decimal::from_str(s).ok(),
        _ => None,
    }
}

fn opt_string(v: &Value) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Maps a 2xx body. Entries with an index outside the batch are dropped;
/// an unparseable id becomes an abstention (the core validates the rest).
pub fn parse_response(
    req: &CategorizeRequest,
    body: &Value,
) -> Result<CategorizeOutput, CategorizeError> {
    let text = body["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or_else(|| {
            CategorizeError::Other(format!(
                "gemini returned no text (finishReason: {})",
                body["candidates"][0]["finishReason"]
                    .as_str()
                    .unwrap_or("none")
            ))
        })?;
    let answers: Vec<Value> = serde_json::from_str(text).map_err(|e| {
        CategorizeError::Other(format!("gemini answer is not the expected JSON: {e}"))
    })?;
    let guesses = answers
        .iter()
        .filter_map(|a| {
            let i = usize::try_from(a["i"].as_u64()?).ok()?;
            let item = req.items.get(i)?;
            let merchant = a
                .get("merchant")
                .filter(|m| m.is_object())
                .map(|m| Merchant {
                    name: opt_string(&m["name"]),
                    domain: opt_string(&m["domain"]).map(|d| d.to_lowercase()),
                });
            Some(Guess {
                key: item.key,
                category_id: a["category_id"]
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok()),
                confidence: decimal_of(&a["confidence"]),
                merchant,
            })
        })
        .collect();
    Ok(CategorizeOutput {
        guesses,
        tokens_in: body["usageMetadata"]["promptTokenCount"]
            .as_i64()
            .map(|n| n as i32),
        tokens_out: output_tokens(&body["usageMetadata"]),
    })
}

/// Billed output: the answer plus the thinking tokens, which Gemini reports
/// apart but charges at the output rate. Unknown only when neither is present.
fn output_tokens(usage: &Value) -> Option<i32> {
    let candidates = usage["candidatesTokenCount"].as_i64();
    let thoughts = usage["thoughtsTokenCount"].as_i64();
    if candidates.is_none() && thoughts.is_none() {
        return None;
    }
    Some((candidates.unwrap_or(0) + thoughts.unwrap_or(0)) as i32)
}
