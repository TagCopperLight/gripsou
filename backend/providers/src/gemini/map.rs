//! Gemini `generateContent` JSON ↔ the canonical categorisation DTOs.

use std::collections::BTreeSet;
use std::str::FromStr;

use gripsou_core::categorize::{
    CategorizeError, CategorizeOutput, CategorizeRequest, Example, Guess, Usage,
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
                "confidence": { "type": "NUMBER" }
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
        CategorizeError::Other(format!(
            "gemini answer is not the expected JSON: {}",
            gripsou_core::logs::error_chain(&e)
        ))
    })?;
    let guesses = answers
        .iter()
        .filter_map(|a| {
            let i = usize::try_from(a["i"].as_u64()?).ok()?;
            let item = req.items.get(i)?;
            Some(Guess {
                key: item.key,
                category_id: a["category_id"]
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok()),
                confidence: decimal_of(&a["confidence"]),
            })
        })
        .collect();
    Ok(CategorizeOutput {
        guesses,
        usage: usage(&body["usageMetadata"]),
        interrupted: None,
    })
}

/// A token count as the API reports it: a non-negative integer that fits.
fn tokens(v: &Value) -> Option<i64> {
    v.as_u64().and_then(|n| i64::try_from(n).ok())
}

/// Billed output is the answer plus the thinking tokens, which Gemini reports
/// apart but charges at the output rate; it is known when either is present.
/// Known only when both input and output are.
fn usage(meta: &Value) -> Usage {
    let tokens_in = tokens(&meta["promptTokenCount"]);
    let candidates = tokens(&meta["candidatesTokenCount"]);
    let thoughts = tokens(&meta["thoughtsTokenCount"]);
    let tokens_out = match (candidates, thoughts) {
        (None, None) => None,
        (c, t) => Some(c.unwrap_or(0).saturating_add(t.unwrap_or(0))),
    };
    Usage {
        tokens_in: tokens_in.unwrap_or(0),
        tokens_out: tokens_out.unwrap_or(0),
        complete: tokens_in.is_some() && tokens_out.is_some(),
    }
}

/// Name fragments of `gemini-*` models that answer `generateContent` but not
/// with JSON text: speech, images, transcription, agents.
const NOT_TEXT: &[&str] = &[
    "tts",
    "image",
    "transcribe",
    "computer-use",
    "robotics",
    "customtools",
];

/// One page of `GET /v1beta/models`: the Gemini models that can categorise,
/// without the `models/` prefix, and the next page's token. The list also
/// holds Gemma, Lyria, Imagen, embeddings and agents, none of which take this
/// adapter's `responseSchema` request.
pub fn parse_models(body: &Value) -> (Vec<String>, Option<String>) {
    let models = body["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| {
            m["supportedGenerationMethods"]
                .as_array()
                .is_some_and(|ms| ms.iter().any(|x| x == "generateContent"))
        })
        .filter_map(|m| m["name"].as_str())
        .map(|n| n.strip_prefix("models/").unwrap_or(n))
        .filter(|n| n.starts_with("gemini-") && !NOT_TEXT.iter().any(|x| n.contains(x)))
        .map(str::to_string)
        .collect();
    let next = body["nextPageToken"]
        .as_str()
        .filter(|t| !t.is_empty())
        .map(str::to_string);
    (models, next)
}
