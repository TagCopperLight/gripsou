//! Second-factor helpers: TOTP codes, the QR for enrolment, and recovery codes.
// Used by the 2FA handlers; Task 4 removes this allow.
#![cfg_attr(not(test), allow(dead_code))]

use argon2::password_hash::rand_core::{OsRng, RngCore};
use totp_rs::{Builder, Secret};

pub const TOTP_STEP_SECS: u64 = 30;
pub const RECOVERY_CODE_COUNT: usize = 10;
const RECOVERY_ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";

/// 20 random bytes (160 bits), the size RFC 4226 recommends.
pub fn new_totp_secret() -> Vec<u8> {
    let mut bytes = vec![0u8; 20];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

/// RFC 4648 base32 without padding: what a user types into an authenticator app.
pub fn base32_secret(secret: &[u8]) -> String {
    Secret::from(secret.to_vec())
        .to_base32()
        .trim_end_matches('=')
        .to_string()
}

fn percent_encode(input: &str) -> String {
    let mut out = String::new();
    for b in input.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn otpauth_uri(secret: &[u8], email: &str) -> String {
    format!(
        "otpauth://totp/gripsou:{}?secret={}&issuer=gripsou&algorithm=SHA1&digits=6&period={TOTP_STEP_SECS}",
        percent_encode(email),
        base32_secret(secret)
    )
}

/// An SVG document of the QR code. Fails only when the data is too long to encode.
pub fn qr_svg(data: &str) -> Result<String, qrcode::types::QrError> {
    Ok(qrcode::QrCode::new(data)?
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build())
}

pub fn current_step(unix_secs: u64) -> u64 {
    unix_secs / TOTP_STEP_SECS
}

/// The 6-digit code for a step (HMAC-SHA1, RFC 6238).
pub fn totp_code(secret: &[u8], step: u64) -> String {
    let totp = Builder::new()
        .with_secret(secret.to_vec())
        .build_noncompliant();
    totp.generate(step * TOTP_STEP_SECS).to_string()
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The step the code matches among the previous, current and next step.
/// Every candidate is compared, without early exit.
pub fn match_totp(secret: &[u8], code: &str, now_unix: u64) -> Option<u64> {
    let code: String = code.chars().filter(|c| *c != ' ').collect();
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let current = current_step(now_unix);
    let mut found = None;
    for step in [current.saturating_sub(1), current, current + 1] {
        if ct_eq(totp_code(secret, step).as_bytes(), code.as_bytes()) {
            found = Some(step);
        }
    }
    found
}

/// Ten codes shaped `xxxxx-xxxxx`, from OS randomness.
pub fn new_recovery_codes() -> Vec<String> {
    let mut codes = Vec::with_capacity(RECOVERY_CODE_COUNT);
    while codes.len() < RECOVERY_CODE_COUNT {
        let mut raw = [0u8; 10];
        OsRng.fill_bytes(&mut raw);
        let chars: Vec<char> = raw
            .iter()
            .map(|b| *b as usize)
            .filter(|n| *n < 248) // 248 = 31 * 8, keeps the pick uniform
            .map(|n| RECOVERY_ALPHABET[n % RECOVERY_ALPHABET.len()] as char)
            .collect();
        if chars.len() < 10 {
            continue;
        }
        let code = format!(
            "{}-{}",
            chars[..5].iter().collect::<String>(),
            chars[5..].iter().collect::<String>()
        );
        if !codes.contains(&code) {
            codes.push(code);
        }
    }
    codes
}

pub fn normalize_recovery_code(input: &str) -> String {
    input
        .chars()
        .filter(|c| *c != ' ' && *c != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

pub fn hash_recovery_code(input: &str) -> Vec<u8> {
    crate::auth::hash_token(&normalize_recovery_code(input))
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238 appendix B, SHA-1 secret, truncated to 6 digits.
    const RFC_SECRET: &[u8] = b"12345678901234567890";

    #[test]
    fn totp_matches_rfc_6238_vectors() {
        assert_eq!(totp_code(RFC_SECRET, current_step(59)), "287082");
        assert_eq!(totp_code(RFC_SECRET, current_step(1111111109)), "081804");
        assert_eq!(totp_code(RFC_SECRET, current_step(1234567890)), "005924");
    }

    #[test]
    fn match_accepts_one_step_either_side_only() {
        let now = 1234567890;
        let step = current_step(now);
        for s in [step - 1, step, step + 1] {
            assert_eq!(
                match_totp(RFC_SECRET, &totp_code(RFC_SECRET, s), now),
                Some(s)
            );
        }
        assert_eq!(
            match_totp(RFC_SECRET, &totp_code(RFC_SECRET, step + 2), now),
            None
        );
        assert_eq!(
            match_totp(RFC_SECRET, &totp_code(RFC_SECRET, step - 2), now),
            None
        );
    }

    #[test]
    fn match_ignores_spaces_and_refuses_junk() {
        let now = 59;
        let code = totp_code(RFC_SECRET, current_step(now));
        let spaced = format!("{} {}", &code[..3], &code[3..]);
        assert!(match_totp(RFC_SECRET, &spaced, now).is_some());
        assert_eq!(match_totp(RFC_SECRET, "", now), None);
        assert_eq!(match_totp(RFC_SECRET, "12345", now), None);
        assert_eq!(match_totp(RFC_SECRET, "abcdef", now), None);
    }

    #[test]
    fn secrets_are_160_bits_and_base32() {
        let s = new_totp_secret();
        assert_eq!(s.len(), 20);
        assert_ne!(s, new_totp_secret());
        assert_eq!(
            base32_secret(b"12345678901234567890"),
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        );
    }

    #[test]
    fn otpauth_uri_names_issuer_and_escapes_email() {
        let uri = otpauth_uri(RFC_SECRET, "ann+x@t.local");
        assert!(uri.starts_with("otpauth://totp/gripsou:ann%2Bx%40t.local?"));
        assert!(uri.contains("secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
        assert!(uri.contains("issuer=gripsou"));
    }

    #[test]
    fn qr_is_an_svg() {
        let svg = qr_svg("otpauth://totp/x?secret=A").unwrap();
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn recovery_codes_are_ten_distinct_readable_codes() {
        let codes = new_recovery_codes();
        assert_eq!(codes.len(), RECOVERY_CODE_COUNT);
        let unique: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(unique.len(), RECOVERY_CODE_COUNT);
        for c in &codes {
            assert_eq!(c.len(), 11);
            assert_eq!(&c[5..6], "-");
            assert!(
                c.chars()
                    .all(|ch| ch == '-' || "abcdefghjkmnpqrstuvwxyz23456789".contains(ch))
            );
        }
    }

    #[test]
    fn recovery_code_hash_ignores_case_spaces_and_dashes() {
        assert_eq!(
            hash_recovery_code("abcde-fghjk"),
            hash_recovery_code(" ABCDE FGHJK ")
        );
        assert_eq!(
            hash_recovery_code("abcde-fghjk"),
            hash_recovery_code("abcdefghjk")
        );
        assert_ne!(
            hash_recovery_code("abcde-fghjk"),
            hash_recovery_code("abcde-fghjm")
        );
    }
}
