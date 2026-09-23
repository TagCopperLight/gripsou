//! Stage 1 of the pipeline (spec §5.2): find the two halves of a movement
//! between the user's own accounts and mark them as one internal transfer, so
//! they stop showing up as income and expense in every chart.
//!
//! The matching rule is deliberately timid. A false pair silently deletes real
//! spending from the Sankey and every total; an unpaired row costs the user one
//! correction. So: mutual nearest neighbour only, and **a tie pairs nothing**
//! — unless the tied rows are interchangeable and as many on each side, which
//! pair one-to-one. Transfers only: see the candidate query.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

/// How far apart the two halves may sit. Three days covers a weekend transfer
/// that clears on Monday.
const WINDOW_DAYS: i64 = 3;

struct Candidate {
    id: Uuid,
    account_id: Uuid,
    ts: DateTime<Utc>,
    amount: Decimal,
    currency: String,
}

/// Two candidates that could be swapped for each other without changing the
/// outcome: every candidate is a transfer and callers only compare rows
/// already sharing currency, amount and sign, so two on the same account are
/// the same movement as far as any total can tell — whatever their date.
fn interchangeable(a: &Candidate, b: &Candidate) -> bool {
    a.account_id == b.account_id
}

/// Pairs every unpaired internal transfer this user has. A single round of
/// mutual-nearest-neighbour matching can leave true pairs on the table: if X's
/// nearest is Y but Y's own nearest is some other row W, neither X-Y nor X-W
/// pairs that round, even though removing Y (paired off with W) may make W's
/// former runner-up X's new, uncontested nearest match. So this repeats the
/// round — each round strictly shrinks the candidate pool by re-querying rows
/// still carrying `transfer_pair_id is null`, so it always terminates — until
/// a round pairs nothing, and returns the total pairs written across all
/// rounds.
///
/// Idempotent in the sense that matters: a row already carrying
/// `transfer_pair_id` is never re-paired, repaired, or disturbed by a later
/// call, and a row a user or a rule has categorised is never touched — an AI
/// guess is the one category_source pairing is allowed to overwrite, per
/// spec §4's precedence (`user > rule > pair > ai`). A call that has already
/// converged writes nothing on a re-run.
///
/// Takes a Postgres advisory transaction lock on `user_id` for the life of
/// the caller's transaction, serialising this pass across any connections of
/// the same user syncing concurrently. Without it, two connections' calls can
/// both read overlapping candidate rows and then issue UPDATEs over the same
/// rows in different orders, deadlocking Postgres and aborting one sync's
/// entire ingest transaction.
pub async fn pair_internal_transfers(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
) -> Result<usize, CoreError> {
    sqlx::query!(
        "select pg_advisory_xact_lock(hashtext($1))",
        user_id.to_string()
    )
    .execute(&mut *conn)
    .await?;

    let mut total = 0usize;
    loop {
        let paired_this_round = pair_one_round(conn, user_id).await?;
        if paired_this_round == 0 {
            break;
        }
        total += paired_this_round;
    }
    Ok(total)
}

/// One round: find every mutual-nearest-neighbour pair among currently
/// unpaired, uncategorised rows, and write them. See
/// [`pair_internal_transfers`] for why this needs to repeat.
async fn pair_one_round(conn: &mut sqlx::PgConnection, user_id: Uuid) -> Result<usize, CoreError> {
    let rows = sqlx::query!(
        r#"
        select t.id          as "id!",
               t.account_id  as "account_id!",
               t.ts          as "ts!",
               t.amount      as "amount!",
               a.currency    as "currency!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where k.user_id = $1
          and t.transfer_pair_id is null
          -- Precedence (spec §4): user > rule > pair > ai, so pairing may
          -- fill an empty slot or overwrite an AI guess, but never a
          -- user/rule categorisation.
          and (t.category_source is null or t.category_source = 'ai')
          and t.amount <> 0
          -- Transfers only. Matching is by amount and date alone, so any
          -- other type lets a coincidence through: a card payment to Betclic
          -- equal to a transfer arriving on another account, or a deposit from a
          -- friend equal to a transfer leaving. Measured on real data, half
          -- the card/deposit pairs were such coincidences. A buy/sell/
          -- dividend/fee/interest row is never a movement between accounts.
          -- Card top-ups of the user's own accounts are left to a category
          -- rule rather than bought back with that error rate.
          and t.type = 'transfer'
        order by t.ts
        "#,
        user_id,
    )
    .fetch_all(&mut *conn)
    .await?;

    let candidates: Vec<Candidate> = rows
        .into_iter()
        .map(|r| Candidate {
            id: r.id,
            account_id: r.account_id,
            ts: r.ts,
            amount: r.amount,
            currency: r.currency,
        })
        .collect();

    // Group by (currency, |amount|): only rows inside one group can ever pair,
    // which keeps the comparison quadratic in the size of a group rather than
    // of the ledger.
    let mut groups: HashMap<(String, Decimal), Vec<&Candidate>> = HashMap::new();
    for c in &candidates {
        groups
            .entry((c.currency.clone(), c.amount.abs()))
            .or_default()
            .push(c);
    }

    let window = chrono::Duration::days(WINDOW_DAYS);
    let mut pairs: Vec<(Uuid, Uuid)> = vec![];

    for (_key, group) in groups {
        let outs: Vec<&&Candidate> = group.iter().filter(|c| c.amount < Decimal::ZERO).collect();
        let ins: Vec<&&Candidate> = group.iter().filter(|c| c.amount > Decimal::ZERO).collect();

        // The nearest counterpart of each row, or None when it has no
        // candidate or when two candidates genuinely tie.
        //
        // A tie between interchangeable candidates (see `interchangeable`) is
        // not ambiguous *when the row choosing has as many twins of its own*
        // (same account, near the tied group): two transfers out of A and two
        // into B pair the same way whichever goes with which. Those resolve to
        // the lowest id, so both sides agree on one pick; the convergence loop
        // in `pair_internal_transfers` pairs the next one on the next round.
        //
        // The group sizes must match. Otherwise a lone row that merely shares
        // the amount (a -10 transfer to a friend two days before two +10
        // top-ups) would claim one of them — the tie between them is what
        // blocks it.
        let nearest =
            |from: &Candidate, own: &[&&Candidate], others: &[&&Candidate]| -> Option<Uuid> {
                let mut best: Option<(i64, &Candidate)> = None;
                let mut tied = false;
                let mut tie_size = 0usize;
                for other in others {
                    if other.account_id == from.account_id {
                        continue;
                    }
                    let gap = (other.ts - from.ts).num_seconds().abs();
                    if gap > window.num_seconds() {
                        continue;
                    }
                    match best {
                        None => {
                            best = Some((gap, other));
                            tie_size = 1;
                        }
                        Some((best_gap, _)) if gap < best_gap => {
                            best = Some((gap, other));
                            tied = false;
                            tie_size = 1;
                        }
                        Some((best_gap, current)) if gap == best_gap => {
                            if !interchangeable(current, other) {
                                tied = true;
                            } else {
                                tie_size += 1;
                                if other.id < current.id {
                                    best = Some((gap, other));
                                }
                            }
                        }
                        _ => {}
                    }
                }
                if tied {
                    return None;
                }
                if tie_size > 1 {
                    // `from`'s own twins: same account, and close enough to the
                    // tied group to be one of its counterparts.
                    let near = best.map(|(_, c)| c.ts).unwrap_or(from.ts);
                    let twins = own
                        .iter()
                        .filter(|c| {
                            interchangeable(from, c)
                                && (c.ts - near).num_seconds().abs() <= window.num_seconds()
                        })
                        .count();
                    if twins != tie_size {
                        return None;
                    }
                }
                best.map(|(_, c)| c.id)
            };

        let out_choice: HashMap<Uuid, Uuid> = outs
            .iter()
            .filter_map(|o| nearest(o, &outs, &ins).map(|pick| (o.id, pick)))
            .collect();
        let in_choice: HashMap<Uuid, Uuid> = ins
            .iter()
            .filter_map(|i| nearest(i, &ins, &outs).map(|pick| (i.id, pick)))
            .collect();

        // Mutual nearest only: both halves must have chosen each other. That is
        // what stops one popular counterpart from being claimed twice.
        for (out_id, in_id) in out_choice {
            if in_choice.get(&in_id) == Some(&out_id) {
                pairs.push((out_id, in_id));
            }
        }
    }

    // A globally consistent lock order for the UPDATEs below. Belt and
    // braces alongside the advisory lock taken at the top of
    // `pair_internal_transfers`: that lock only guards this function's own
    // critical section, not every other statement the enclosing ingest
    // transaction runs before and after it, so two concurrent syncs' row
    // locks could otherwise still be acquired in different orders.
    pairs.sort_unstable();

    // Counted from what the UPDATE actually wrote, not from `pairs.len()`.
    // The convergence loop in `pair_internal_transfers` only continues when a
    // round reports progress, so this count is the thing that has to be
    // trustworthy: if the join below ever matched nothing (this user's
    // `internal_transfer` category missing) and this loop just moved on,
    // `pair_one_round` would report a pair that was never written, the next
    // round would re-select the same two rows and recompute the same pair,
    // and the outer loop would spin forever inside the ingest transaction's
    // lock. So a write that doesn't touch both rows is a hard error instead.
    let mut written = 0usize;
    for (out_id, in_id) in &pairs {
        let result = sqlx::query!(
            r#"
            update transaction t
               set transfer_pair_id = case when t.id = $1 then $2 else $1 end,
                   budget_category_id = c.id,
                   category_source = 'pair'
              from budget_category c
             where t.id in ($1, $2)
               and c.user_id = $3
               and c.system_key = 'internal_transfer'
            "#,
            out_id,
            in_id,
            user_id,
        )
        .execute(&mut *conn)
        .await?;

        if result.rows_affected() != 2 {
            return Err(CoreError::TransferPairNotWritten {
                user_id,
                out_id: *out_id,
                in_id: *in_id,
                rows: result.rows_affected(),
            });
        }
        written += 1;
    }

    Ok(written)
}
