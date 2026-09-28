//! Jev `systemone` JSON ↔ the canonical categorisation DTOs.

use std::fmt::Write;
use std::str::FromStr;

use gripsou_core::categorize::{CategorizeItem, CategorizeRequest, Example, Guess, Usage};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub const QUESTION: &str = "category";
pub const NONE: &str = "none";

const INSTRUCTIONS: &str = "Which of the user's budget categories does this bank transaction belong to? \
The description is a raw French bank wording. A negative amount is money going out. \
The confirmed examples are the user's own past decisions. Choose \"none\" if no category fits.";

fn direction(amount: Decimal) -> &'static str {
    if amount < Decimal::ZERO {
        "money out"
    } else {
        "money in"
    }
}

fn example_line(req: &CategorizeRequest, e: &Example) -> String {
    format!(
        "- {} | {} {} ({}) | {} | {} -> {}",
        e.date,
        e.amount,
        e.currency,
        direction(e.amount),
        e.account_type,
        e.description,
        req.category_name(e.category_id).unwrap_or("?"),
    )
}

/// The `state`: the transaction, then its evidence, as plain text.
pub fn state(req: &CategorizeRequest, item: &CategorizeItem) -> String {
    let mut s = String::new();
    let _ = writeln!(s, "Transaction: {}", item.description);
    let _ = writeln!(
        s,
        "Amount: {} {} ({})",
        item.amount,
        item.currency,
        direction(item.amount)
    );
    let _ = writeln!(s, "Account type: {}", item.account_type);
    let _ = writeln!(s, "Date: {}", item.date);
    if !item.examples.is_empty() {
        let _ = writeln!(s, "\nConfirmed examples:");
        for e in &item.examples {
            let _ = writeln!(s, "{}", example_line(req, e));
        }
    }
    if !req.shared_examples.is_empty() {
        let _ = writeln!(s, "\nRecent corrections:");
        for e in &req.shared_examples {
            let _ = writeln!(s, "{}", example_line(req, e));
        }
    }
    s
}

pub fn build_body(req: &CategorizeRequest, item: &CategorizeItem, model: &str) -> Value {
    let mut criteria = Map::new();
    for id in &item.candidates {
        if let Some(c) = req.categories.iter().find(|c| c.id == *id) {
            let desc = match c.hint.as_deref().map(str::trim).filter(|h| !h.is_empty()) {
                Some(h) => format!("{} — {h}", c.name),
                None => c.name.clone(),
            };
            criteria.insert(id.to_string(), Value::String(desc));
        }
    }
    criteria.insert(
        NONE.to_string(),
        Value::String("None of these categories fits".into()),
    );
    json!({
        "state": state(req, item),
        "model": model,
        "questions": { QUESTION: { "type": "choice", "instructions": INSTRUCTIONS, "criteria": criteria } }
    })
}

/// A token count as the API reports it: a non-negative integer that fits.
fn tokens(v: &Value) -> Option<i64> {
    v.as_u64().and_then(|n| i64::try_from(n).ok())
}

/// The confidence from the number's own text, never through a float.
fn decimal_of(v: &Value) -> Option<Decimal> {
    match v {
        Value::Number(n) => {
            let s = n.to_string();
            Decimal::from_str(&s)
                .or_else(|_| Decimal::from_scientific(&s))
                .ok()
        }
        _ => None,
    }
}

/// One item's answer and the tokens it cost. `none` or an option that is not
/// a category id is an abstention; a body with no choice at all is no answer
/// (`None`), so the item is sent again later. Usage is unknown unless both
/// counts are reported.
pub fn parse_answer(item: &CategorizeItem, body: &Value) -> (Option<Guess>, Usage) {
    let a = &body["answers"][QUESTION];
    let guess = a["choice"].as_str().map(|choice| Guess {
        key: item.key,
        category_id: Some(choice)
            .filter(|c| *c != NONE)
            .and_then(|c| Uuid::parse_str(c).ok()),
        confidence: decimal_of(&a["confidence"]),
    });
    let usage = match (
        tokens(&body["usage"]["input_tokens"]),
        tokens(&body["usage"]["output_tokens"]),
    ) {
        (Some(i), Some(o)) => Usage::known(i, o),
        (i, o) => Usage {
            tokens_in: i.unwrap_or(0),
            tokens_out: o.unwrap_or(0),
            complete: false,
        },
    };
    (guess, usage)
}
