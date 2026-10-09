pub mod boursorama;
pub mod gemini;
pub mod jev;
pub mod powens;
pub mod yahoo;

/// A JSON decode error as `"{what} decode error (<kind>) at line L column C"`.
/// serde's own text quotes the offending value (an amount, a description),
/// and this text reaches the connection's error and the saved logs, so it is
/// dropped: the position is enough to find it in a recorded body.
pub(crate) fn json_decode_error(what: &str, e: &serde_json::Error) -> String {
    format!(
        "{what} decode error ({:?}) at line {} column {}",
        e.classify(),
        e.line(),
        e.column()
    )
}

#[cfg(test)]
mod tests {
    use super::json_decode_error;

    #[test]
    fn a_decode_error_does_not_quote_the_value() {
        #[derive(Debug, serde::Deserialize)]
        #[allow(dead_code)]
        struct Row {
            value: i64,
        }
        let e = serde_json::from_str::<Row>(r#"{"value": "Boulangerie 12.34"}"#).unwrap_err();
        assert!(e.to_string().contains("Boulangerie"), "serde quotes it");
        let text = json_decode_error("/users/me/transactions", &e);
        assert!(!text.contains("Boulangerie"), "{text}");
        assert!(text.starts_with("/users/me/transactions decode error (Data) at line 1"));
    }
}
