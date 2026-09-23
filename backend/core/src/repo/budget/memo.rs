//! The merchant memo (phase 5 spec §7): one merchant name and domain per
//! normalised description, per user. The AI fills it; the user corrects it,
//! and a user entry is never overwritten. It stores no categories (§2.1).

use uuid::Uuid;

use crate::budget::ai::Decision;
use crate::error::CoreError;

/// A web domain fit for a Brandfetch URL, or `None`. Models return
/// `https://www.x.fr/`, users paste the same; both become `x.fr`. Anything
/// that could smuggle a path into the logo URL is rejected.
pub fn clean_domain(raw: &str) -> Option<String> {
    let mut d = raw.trim().to_lowercase();
    for scheme in ["https://", "http://"] {
        if let Some(rest) = d.strip_prefix(scheme) {
            d = rest.to_string();
        }
    }
    let d = d.split(['/', '?', '#']).next().unwrap_or("");
    let d = d.split(':').next().unwrap_or("");
    let d = d.strip_prefix("www.").unwrap_or(d);
    let valid_chars = d
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    let labels: Vec<&str> = d.split('.').collect();
    let tld_ok = labels
        .last()
        .is_some_and(|t| t.len() >= 2 && t.chars().all(|c| c.is_ascii_alphabetic()));
    if !valid_chars
        || labels.len() < 2
        || labels.iter().any(|l| l.is_empty())
        || !tld_ok
        || d.len() > 253
        || labels.iter().any(|l| l.len() > 63)
    {
        return None;
    }
    Some(d.to_string())
}

#[derive(Debug, PartialEq, Eq)]
pub enum MerchantWrite {
    Saved,
    Cleared,
    NotFound,
    /// The row's description normalises to `''`: it has no identity to key on.
    NoIdentity,
}

/// Records the merchants of one chunk's decisions. Only decisions carrying a
/// valid domain are kept; an entry the user wrote is never replaced.
pub async fn record_ai_merchants(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    decisions: &[Decision],
) -> Result<u64, CoreError> {
    let mut n = 0;
    for d in decisions {
        let Some(m) = &d.merchant else { continue };
        let Some(domain) = m.domain.as_deref().and_then(clean_domain) else {
            continue;
        };
        let name = m.name.as_deref().map(str::trim).filter(|s| !s.is_empty());
        n += sqlx::query!(
            r#"
            insert into budget_memo (user_id, norm_description, origin, merchant_name, merchant_domain)
            select $1, budget_norm_description(t.description), 'ai', $3, $4
              from transaction t
              join account a    on a.id = t.account_id
              join connection k on k.id = a.connection_id
             where t.id = $2 and k.user_id = $1
               and budget_norm_description(t.description) <> ''
            on conflict (user_id, norm_description) do update
               set merchant_name = excluded.merchant_name,
                   merchant_domain = excluded.merchant_domain,
                   updated_at = now()
             where budget_memo.origin = 'ai'
            "#,
            user_id,
            d.txn_id,
            name,
            domain,
        )
        .execute(pool)
        .await?
        .rows_affected();
    }
    Ok(n)
}

/// The user's correction, keyed on this row's normalised description, so it
/// fixes every row sharing it. Both fields empty removes the entry. A domain
/// that is not a domain is stored as none (the name alone is still kept).
pub async fn set_user_merchant(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    name: Option<&str>,
    domain: Option<&str>,
) -> Result<MerchantWrite, CoreError> {
    let norm: Option<Option<String>> = sqlx::query_scalar!(
        r#"
        select budget_norm_description(t.description)
          from transaction t
          join account a    on a.id = t.account_id
          join connection k on k.id = a.connection_id
         where t.id = $1 and k.user_id = $2
        "#,
        txn_id,
        user_id
    )
    .fetch_optional(pool)
    .await?;
    let Some(norm) = norm else {
        return Ok(MerchantWrite::NotFound);
    };
    let Some(norm) = norm.filter(|n| !n.is_empty()) else {
        return Ok(MerchantWrite::NoIdentity);
    };

    let name = name.map(str::trim).filter(|s| !s.is_empty());
    let domain = domain.and_then(clean_domain);
    if name.is_none() && domain.is_none() {
        sqlx::query!(
            "delete from budget_memo where user_id = $1 and norm_description = $2",
            user_id,
            norm
        )
        .execute(pool)
        .await?;
        return Ok(MerchantWrite::Cleared);
    }
    sqlx::query!(
        r#"
        insert into budget_memo (user_id, norm_description, origin, merchant_name, merchant_domain)
        values ($1, $2, 'user', $3, $4)
        on conflict (user_id, norm_description) do update
           set origin = 'user',
               merchant_name = excluded.merchant_name,
               merchant_domain = excluded.merchant_domain,
               updated_at = now()
        "#,
        user_id,
        norm,
        name,
        domain,
    )
    .execute(pool)
    .await?;
    Ok(MerchantWrite::Saved)
}

#[cfg(test)]
mod tests {
    use super::clean_domain;

    #[test]
    fn keeps_a_bare_domain_lowercased() {
        assert_eq!(clean_domain("Leclerc.FR").as_deref(), Some("leclerc.fr"));
    }

    #[test]
    fn strips_scheme_www_path_and_port() {
        assert_eq!(
            clean_domain("https://www.burgerking.fr/menu?x=1").as_deref(),
            Some("burgerking.fr")
        );
        assert_eq!(
            clean_domain("http://sncf-connect.com:443").as_deref(),
            Some("sncf-connect.com")
        );
    }

    #[test]
    fn rejects_what_is_not_a_domain() {
        assert_eq!(clean_domain(""), None);
        assert_eq!(clean_domain("Leclerc"), None);
        assert_eq!(clean_domain("a b.fr"), None);
        assert_eq!(clean_domain("../etc/passwd"), None);
    }

    #[test]
    fn rejects_a_label_over_63_chars() {
        let label = "a".repeat(64);
        assert_eq!(clean_domain(&format!("{label}.fr")), None);
        let ok_label = "a".repeat(63);
        assert_eq!(
            clean_domain(&format!("{ok_label}.fr")).as_deref(),
            Some(format!("{ok_label}.fr").as_str())
        );
    }

    #[test]
    fn rejects_a_domain_over_253_chars() {
        // Labels of 63 'a's joined by dots, kept under the 253 cap per-label,
        // then pushed over the total cap.
        let long = std::iter::repeat_n("a".repeat(63), 5)
            .collect::<Vec<_>>()
            .join(".")
            + ".fr";
        assert!(long.len() > 253);
        assert_eq!(clean_domain(&long), None);
    }
}
