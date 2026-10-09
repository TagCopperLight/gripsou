//! Lot suggestions: a quantity change seen between two snapshots, matched to
//! the one buy/sell transaction that explains it, offered to the user as a
//! pre-filled row of the record-lots form. Nothing here writes: a false match
//! would corrupt the cost basis silently, so the user confirms every one.
//!
//! The match never reads the transaction's wording (it is broker-specific).
//! It uses only `type in ('buy','sell')`, the day and the size of the amount;
//! the direction comes from the quantity change, because Trade Republic
//! mirrors each trade on its portfolio account with the opposite sign and type.
//!
//! The fee is never guessed: every reader of a lot uses `quantity × price ±
//! fee`, so putting the whole amount in the price changes no figure.

use std::collections::HashMap;

use chrono::NaiveDate;
use rust_decimal::{Decimal, RoundingStrategy};
use uuid::Uuid;

/// A buy/sell transaction whose day and amount fit a jump.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub txn_id: Uuid,
    pub day: NaiveDate,
    pub amount: Decimal,
}

/// A quantity change of one holding between two snapshots, not yet covered by
/// a lot, with every transaction that could explain it.
#[derive(Debug, Clone)]
pub struct Jump {
    pub holding_id: Uuid,
    /// The snapshot day the new quantity was first seen.
    pub day: NaiveDate,
    /// New quantity minus the previous one (from 0 for a first snapshot).
    pub dq: Decimal,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    pub holding_id: Uuid,
    pub side: &'static str,
    pub date: NaiveDate,
    pub quantity: Decimal,
    pub unit_price: Decimal,
    pub fee: Decimal,
}

/// Keep only the unambiguous matches: a jump with exactly one candidate,
/// which no other jump of the account also claims. Anything else is left to
/// the user, exactly as before this feature existed.
pub fn pick(jumps: &[Jump]) -> Vec<Suggestion> {
    // How many jumps each transaction could explain, across the account.
    let mut claims: HashMap<Uuid, usize> = HashMap::new();
    for j in jumps {
        for c in &j.candidates {
            *claims.entry(c.txn_id).or_default() += 1;
        }
    }

    jumps
        .iter()
        .filter_map(|j| {
            let [c] = j.candidates.as_slice() else {
                return None;
            };
            if claims[&c.txn_id] != 1 || j.dq.is_zero() {
                return None;
            }
            let quantity = j.dq.abs();
            let unit_price = (c.amount.abs() / quantity)
                .round_dp_with_strategy(8, RoundingStrategy::MidpointAwayFromZero)
                .normalize();
            Some(Suggestion {
                holding_id: j.holding_id,
                side: if j.dq > Decimal::ZERO { "buy" } else { "sell" },
                date: c.day,
                quantity: quantity.normalize(),
                unit_price,
                fee: Decimal::ZERO,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(s: &str) -> Decimal {
        s.parse().unwrap()
    }
    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }
    fn cand(id: u128, d: u32, amount: &str) -> Candidate {
        Candidate {
            txn_id: Uuid::from_u128(id),
            day: day(d),
            amount: dec(amount),
        }
    }
    fn jump(holding: u128, dq: &str, candidates: Vec<Candidate>) -> Jump {
        Jump {
            holding_id: Uuid::from_u128(holding),
            day: day(8),
            dq: dec(dq),
            candidates,
        }
    }

    #[test]
    fn one_jump_one_candidate_is_suggested() {
        let got = pick(&[jump(1, "23", vec![cand(10, 8, "-146.17")])]);
        assert_eq!(
            got,
            vec![Suggestion {
                holding_id: Uuid::from_u128(1),
                side: "buy",
                date: day(8),
                quantity: dec("23"),
                unit_price: dec("6.35521739"),
                fee: Decimal::ZERO,
            }]
        );
    }

    #[test]
    fn the_sign_of_the_amount_is_ignored() {
        // A mirrored row: positive amount for a purchase.
        let got = pick(&[jump(1, "2", vec![cand(10, 8, "100")])]);
        assert_eq!(got[0].side, "buy");
        assert_eq!(got[0].unit_price, dec("50"));
    }

    #[test]
    fn a_sale_has_a_positive_quantity_and_price() {
        let got = pick(&[jump(1, "-10", vec![cand(10, 8, "63.60")])]);
        assert_eq!(got[0].side, "sell");
        assert_eq!(got[0].quantity, dec("10"));
        assert_eq!(got[0].unit_price, dec("6.36"));
    }

    #[test]
    fn two_candidates_suggest_nothing() {
        let got = pick(&[jump(
            1,
            "23",
            vec![cand(10, 8, "-146.17"), cand(11, 9, "-146.00")],
        )]);
        assert!(got.is_empty());
    }

    #[test]
    fn no_candidate_suggests_nothing() {
        assert!(pick(&[jump(1, "23", vec![])]).is_empty());
    }

    #[test]
    fn a_transaction_claimed_by_two_jumps_suggests_neither() {
        let got = pick(&[
            jump(1, "10", vec![cand(10, 8, "-100")]),
            jump(2, "5", vec![cand(10, 8, "-100")]),
        ]);
        assert!(got.is_empty());
    }

    #[test]
    fn two_jumps_with_their_own_transaction_are_both_suggested() {
        let got = pick(&[
            jump(1, "10", vec![cand(10, 8, "-100")]),
            jump(2, "5", vec![cand(11, 8, "-50")]),
        ]);
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn the_quantity_is_written_without_trailing_zeros() {
        // Snapshots store quantities as numeric(…, 6): 23.000000.
        let got = pick(&[jump(1, "23.000000", vec![cand(10, 8, "-146.1700000000")])]);
        assert_eq!(got[0].quantity.to_string(), "23");
        assert_eq!(got[0].unit_price.to_string(), "6.35521739");
    }
}
