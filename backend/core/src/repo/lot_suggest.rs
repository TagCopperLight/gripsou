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

use crate::error::CoreError;

/// A buy/sell transaction whose day and amount fit a jump.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub txn_id: Uuid,
    pub day: NaiveDate,
    pub amount: Decimal,
}

/// A quantity change of one holding between two snapshots, with every
/// transaction that could explain it.
#[derive(Debug, Clone)]
pub struct Jump {
    pub holding_id: Uuid,
    /// The snapshot day the new quantity was first seen.
    pub day: NaiveDate,
    /// New quantity minus the previous one (from 0 for a first snapshot).
    pub dq: Decimal,
    /// False when a lot already covers it or the holding's lots explain its
    /// quantity: it gets no suggestion but still claims its candidates.
    pub open: bool,
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

/// Keep only the unambiguous matches: an open jump with exactly one candidate,
/// which no other jump of the account also claims. Closed jumps (already
/// covered or explained) get no suggestion but still count as claimants, so
/// their transaction is never handed to another holding. Anything else is left
/// to the user, exactly as before this feature existed.
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
            if !j.open || claims[&c.txn_id] != 1 || j.dq.is_zero() {
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

/// The account a holding lives in, and its currency, if the caller owns it.
struct AccountRef {
    id: Uuid,
    currency: String,
}

/// Every quantity jump of the account's non-cash holdings, with its
/// candidate transactions. See the spec for each rule; in short:
/// - a jump is a snapshot whose quantity differs from the holding's previous
///   one, or a holding's first snapshot when the account already had an
///   earlier snapshot (a rise from 0);
/// - its window is [min(prev_day + 1, day − 3), day + 3];
/// - it is closed (`open = false`) when a lot of the same side lies in that
///   window, or when the holding's lots explain its quantity; closed jumps
///   are kept so they still claim their candidates;
/// - a candidate is a buy or sell of the account, in the window, whose
///   absolute amount is within 5 % of the shares' market value that day.
async fn account_jumps(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    account: &AccountRef,
) -> Result<Vec<Jump>, CoreError> {
    let rows = sqlx::query!(
        r#"
        with snaps as (
            select h.id as holding_id, h.instrument_id, s.as_of, s.quantity,
                   lag(s.quantity) over w as prev_qty,
                   lag(s.as_of)    over w as prev_day,
                   row_number()    over w as rn
            from holding h
            join instrument i       on i.id = h.instrument_id and i.kind <> 'cash'
            join holding_snapshot s on s.holding_id = h.id
            where h.account_id = $1
            window w as (partition by h.id order by s.as_of)
        ),
        jumps as (
            select holding_id, instrument_id, as_of as day, prev_day,
                   quantity - prev_qty as dq
            from snaps
            where rn > 1 and quantity <> prev_qty
            union all
            select sn.holding_id, sn.instrument_id, sn.as_of, w.prev_day, sn.quantity
            from snaps sn
            cross join lateral (
                select max(s2.as_of) as prev_day
                from holding_snapshot s2
                join holding h2 on h2.id = s2.holding_id
                where h2.account_id = $1 and s2.as_of < sn.as_of
            ) w
            where sn.rn = 1 and sn.quantity <> 0 and w.prev_day is not null
        ),
        open_jumps as (
            select j.holding_id, j.instrument_id, j.day, j.dq,
                   least(j.prev_day + 1, j.day - 3) as win_from,
                   j.day + 3 as win_to,
                   b.explained_qty <> h.quantity
                   and not exists (
                       select 1 from lot l
                       where l.holding_id = j.holding_id
                         and l.side = case when j.dq > 0 then 'buy' else 'sell' end
                         and l.acquired_on between least(j.prev_day + 1, j.day - 3)
                                               and j.day + 3
                   ) as "open"
            from jumps j
            join holding h on h.id = j.holding_id
            join lateral lot_basis(array[h.id], array[user_today($3)]) b on true
        )
        select oj.holding_id as "holding_id!", oj.day as "day!", oj.dq as "dq!", oj."open" as "open!",
               c.id as "txn_id?", c.day as "txn_day?", c.amount as "amount?"
        from open_jumps oj
        left join lateral (
            select t.id, d.day, t.amount
            from transaction t
            cross join lateral (select (t.ts at time zone 'utc')::date as day) d
            cross join lateral (
                select abs(oj.dq) * unit_value_asof(oj.instrument_id, d.day)
                       / nullif(fx_asof($2, d.day), 0) as expected
            ) e
            where t.account_id = $1
              and t.type in ('buy', 'sell')
              and d.day between oj.win_from and oj.win_to
              and abs(t.amount) between 0.95 * e.expected and 1.05 * e.expected
        ) c on true
        order by oj.holding_id, oj.day, c.day, c.id
        "#,
        account.id,
        account.currency,
        user_id,
    )
    .fetch_all(pool)
    .await?;

    let mut jumps: Vec<Jump> = Vec::new();
    for r in rows {
        let same = jumps
            .last()
            .is_some_and(|j| j.holding_id == r.holding_id && j.day == r.day);
        if !same {
            jumps.push(Jump {
                holding_id: r.holding_id,
                day: r.day,
                dq: r.dq,
                open: r.open,
                candidates: Vec::new(),
            });
        }
        if let (Some(txn_id), Some(day), Some(amount)) = (r.txn_id, r.txn_day, r.amount) {
            jumps
                .last_mut()
                .expect("pushed above")
                .candidates
                .push(Candidate {
                    txn_id,
                    day,
                    amount,
                });
        }
    }
    Ok(jumps)
}

/// This holding's suggested lots. `Ok(None)` when the holding is unknown or
/// not the caller's, which the API must render as 404, like the sibling lot
/// endpoints. Uniqueness is decided across the whole account (two holdings
/// may compete for one transaction), then filtered to the holding asked for.
pub async fn suggest_lots(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    holding_id: Uuid,
) -> Result<Option<Vec<Suggestion>>, CoreError> {
    let account = sqlx::query_as!(
        AccountRef,
        r#"
        select a.id as "id!", a.currency as "currency!"
        from holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1 and c.user_id = $2
        "#,
        holding_id,
        user_id,
    )
    .fetch_optional(pool)
    .await?;
    let Some(account) = account else {
        return Ok(None);
    };

    let jumps = account_jumps(pool, user_id, &account).await?;
    Ok(Some(
        pick(&jumps)
            .into_iter()
            .filter(|s| s.holding_id == holding_id)
            .collect(),
    ))
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
            open: true,
            candidates,
        }
    }
    fn closed(mut j: Jump) -> Jump {
        j.open = false;
        j
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
    fn a_closed_jump_still_claims_its_transaction() {
        let got = pick(&[
            closed(jump(1, "10", vec![cand(10, 8, "-100")])),
            jump(2, "5", vec![cand(10, 8, "-100")]),
        ]);
        assert!(got.is_empty());
    }

    #[test]
    fn a_closed_jump_alone_suggests_nothing() {
        let got = pick(&[closed(jump(1, "10", vec![cand(10, 8, "-100")]))]);
        assert!(got.is_empty());
    }

    #[test]
    fn the_quantity_is_written_without_trailing_zeros() {
        // Snapshots store quantities as numeric(…, 6): 23.000000.
        let got = pick(&[jump(1, "23.000000", vec![cand(10, 8, "-146.1700000000")])]);
        assert_eq!(got[0].quantity.to_string(), "23");
        assert_eq!(got[0].unit_price.to_string(), "6.35521739");
    }
}
