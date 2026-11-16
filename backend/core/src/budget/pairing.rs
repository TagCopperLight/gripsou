//! The budget pairing pass, run inside every ingest: marks the two halves of a movement between the
//! user's own accounts as one internal transfer.
//!
//! Matching is mutual nearest neighbour only; a tie pairs nothing, unless the tied rows are
//! interchangeable and as many on each side. What is left gets one more look in [`forced_pairs`].

use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::budget::vocab::{CategoryKind, CategorySource, SystemKey};
use crate::db::UserWriteTx;
use crate::error::CoreError;

/// Five days, not three, also catch a card top-up that settles a few days late.
const WINDOW_DAYS: i64 = 5;

struct Candidate {
    id: Uuid,
    account_id: Uuid,
    day: NaiveDate,
    amount: Decimal,
    currency: String,
}

/// Two candidates that can be swapped in a nearest-neighbour tie: on one account they are the same
/// movement for any total, whatever their date. [`forced_pairs`] uses a stricter test (same account and
/// same day), because it measures reach from one day per node.
fn interchangeable(a: &Candidate, b: &Candidate) -> bool {
    a.account_id == b.account_id
}

/// Computes the user's pairs from scratch, writes only the difference, and returns how many pairs it
/// wrote. Starting from scratch lets a correction take effect. A pair that no longer holds is unlinked,
/// and a half whose category pairing set goes back to uncategorised; a category someone chose stays.
///
/// One round of mutual nearest neighbour can leave true pairs (X's nearest is Y, but Y's nearest is W),
/// so rounds repeat in memory until one pairs nothing. Each round removes the rows it paired, so the
/// loop terminates.
///
/// A row in a neutral category may gain or lose a partner but keeps its category.
pub async fn pair_internal_transfers(tx: &mut UserWriteTx<'_>) -> Result<usize, CoreError> {
    let user_id = tx.user_id();
    let rows = sqlx::query!(
        r#"
        select t.id          as "id!",
               t.account_id  as "account_id!",
               t.spent_on    as "day!",
               t.amount      as "amount!",
               a.currency    as "currency!",
               t.transfer_pair_id
        -- The cash leg of a buy/sell is the lot's record and mirrors across a broker's accounts: pairing those
        -- copies would mean nothing.
        from budget_transactions($1) t
        join account a on a.id = t.account_id
        left join budget_category c on c.id = t.budget_category_id
        where t.amount <> 0
          and (
              -- A transfer whose category pairing may still decide: empty, an unreviewed AI guess, or filed by pairing.
              --
              -- Only transfers: other types matched on amount and date alone pair coincidences, and their ties block
              -- good pairs.
              (t.type = 'transfer'
               and not budget_user_chose(t.category_source, t.category_reviewed_at))
              -- Any row already in a neutral category: pairing it hides nothing that was counted. This catches a real
              -- transfer the provider labels a deposit or card payment, once the user has filed it.
              or c.kind = $2
          )
        order by t.spent_on
        "#,
        user_id,
        CategoryKind::Neutral as CategoryKind,
    )
    .fetch_all(&mut **tx)
    .await?;

    let current: HashMap<Uuid, Option<Uuid>> =
        rows.iter().map(|r| (r.id, r.transfer_pair_id)).collect();
    let mut candidates: Vec<Candidate> = rows
        .into_iter()
        .map(|r| Candidate {
            id: r.id,
            account_id: r.account_id,
            day: r.day,
            amount: r.amount,
            currency: r.currency,
        })
        .collect();

    let mut pairs: Vec<(Uuid, Uuid)> = vec![];
    loop {
        let mut round = nearest_pairs(&candidates);
        // The rounds have converged. What is left is mostly chains through a middle account (every row ties,
        // yet one pairing explains them all). Tried last so nearest-in-time gets first say.
        if round.is_empty() {
            round = forced_pairs(&candidates);
        }
        if round.is_empty() {
            break;
        }
        let taken: HashSet<Uuid> = round.iter().flat_map(|&(o, i)| [o, i]).collect();
        candidates.retain(|c| !taken.contains(&c.id));
        pairs.extend(round);
    }

    let links: Vec<(Uuid, Uuid)> = pairs.iter().flat_map(|&(o, i)| [(o, i), (i, o)]).collect();
    let kept: Vec<Uuid> = links.iter().map(|&(id, _)| id).collect();

    // Pairs this run did not find again: every paired row of the user outside `kept`. Clearing the source
    // in the same statement keeps the partner-deleted trigger out of it.
    sqlx::query!(
        r#"
        update transaction t
           set transfer_pair_id = null,
               budget_category_id = case when t.category_source = $3
                                         then null else t.budget_category_id end,
               category_source = case when t.category_source = $3
                                      then null else t.category_source end
         where t.id in (select id from user_transactions($1))
           and t.transfer_pair_id is not null
           and not (t.id = any($2))
        "#,
        user_id,
        &kept,
        CategorySource::Pair as CategorySource,
    )
    .execute(&mut **tx)
    .await?;

    let (ids, partners): (Vec<Uuid>, Vec<Uuid>) = links
        .into_iter()
        .filter(|(id, partner)| current.get(id).copied().flatten() != Some(*partner))
        .unzip();
    if ids.is_empty() {
        return Ok(0);
    }
    // A category the user chose is kept: only the link is added. Every other row becomes a pairing-set
    // internal transfer, and the AI's confidence and review stamp go with the guess they described.
    sqlx::query!(
        r#"
        update transaction t
           set transfer_pair_id = p.partner,
               budget_category_id = case when o.user_chose then t.budget_category_id else c.id end,
               category_source = case when o.user_chose then t.category_source else $4 end,
               category_confidence = case when o.user_chose then t.category_confidence end,
               category_reviewed_at = case when o.user_chose then t.category_reviewed_at end
          from unnest($1::uuid[], $2::uuid[]) as p(id, partner)
          join lateral (
              select budget_user_chose(x.category_source, x.category_reviewed_at) as user_chose
              from transaction x
              where x.id = p.id
          ) o on true,
               budget_category c
         where t.id = p.id
           and c.user_id = $3
           and c.system_key = $5
        "#,
        &ids,
        &partners,
        user_id,
        CategorySource::Pair as CategorySource,
        SystemKey::InternalTransfer as SystemKey,
    )
    .execute(&mut **tx)
    .await?;

    Ok(ids.len() / 2)
}

/// Only rows in one group can pair, so comparison cost follows a group, not the ledger.
fn groups(candidates: &[Candidate]) -> impl Iterator<Item = Vec<&Candidate>> {
    let mut groups: HashMap<(&str, Decimal), Vec<&Candidate>> = HashMap::new();
    for c in candidates {
        groups
            .entry((c.currency.as_str(), c.amount.abs()))
            .or_default()
            .push(c);
    }
    groups.into_values()
}

fn nearest_pairs(candidates: &[Candidate]) -> Vec<(Uuid, Uuid)> {
    let mut pairs: Vec<(Uuid, Uuid)> = vec![];
    for group in groups(candidates) {
        let outs: Vec<&&Candidate> = group.iter().filter(|c| c.amount < Decimal::ZERO).collect();
        let ins: Vec<&&Candidate> = group.iter().filter(|c| c.amount > Decimal::ZERO).collect();

        // The nearest counterpart of each row, or None when there is none or two genuinely tie.
        //
        // A tie between interchangeable candidates is not ambiguous when the chooser has as many twins (same
        // account, near the tied group). Those resolve to the lowest id so both sides agree on one pick.
        // The group sizes must match, or a lone row that merely shares the amount would claim one of them.
        let nearest =
            |from: &Candidate, own: &[&&Candidate], others: &[&&Candidate]| -> Option<Uuid> {
                let mut best: Option<(i64, &Candidate)> = None;
                let mut tied = false;
                let mut tie_size = 0usize;
                for other in others {
                    if other.account_id == from.account_id {
                        continue;
                    }
                    let gap = (other.day - from.day).num_days().abs();
                    if gap > WINDOW_DAYS {
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
                    // `from`'s twins: same account, close to the tied group.
                    let near = best.map(|(_, c)| c.day).unwrap_or(from.day);
                    let twins = own
                        .iter()
                        .filter(|c| {
                            interchangeable(from, c)
                                && (c.day - near).num_days().abs() <= WINDOW_DAYS
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

        // Both halves must have chosen each other, so one popular counterpart is not claimed twice.
        for (out_id, in_id) in out_choice {
            if in_choice.get(&in_id) == Some(&out_id) {
                pairs.push((out_id, in_id));
            }
        }
    }

    pairs
}

/// Pairs that every consistent explanation of a cluster agrees on.
///
/// Rows sharing currency and amount are linked when they could be two halves of one transfer. A cluster
/// is acted on only when every row in it can be paired off; within it, a link pairs only when no complete
/// pairing can do without it.
///
/// Reach grows a day at a time up to [`WINDOW_DAYS`], so same-day chains settle first.
///
/// Rows on one account on one day count as one node, so two identical same-day chains pair instead of
/// tying. Stricter than [`interchangeable`], which ignores the date.
fn forced_pairs(candidates: &[Candidate]) -> Vec<(Uuid, Uuid)> {
    let mut pairs = vec![];
    for group in groups(candidates) {
        // Nodes: identical rows, sorted by id so both runs of a converged pass pick the same rows.
        let mut outs: Vec<Vec<&Candidate>> = vec![];
        let mut ins: Vec<Vec<&Candidate>> = vec![];
        let mut by_key: HashMap<(bool, Uuid, NaiveDate), usize> = HashMap::new();
        for c in group {
            let side = if c.amount < Decimal::ZERO {
                &mut outs
            } else {
                &mut ins
            };
            let slot = *by_key
                .entry((c.amount < Decimal::ZERO, c.account_id, c.day))
                .or_insert_with(|| {
                    side.push(vec![]);
                    side.len() - 1
                });
            side[slot].push(c);
        }
        for node in outs.iter_mut().chain(ins.iter_mut()) {
            node.sort_by_key(|c| c.id);
        }

        for reach in 0..=WINDOW_DAYS {
            let found = forced_in_group(&outs, &ins, reach);
            if !found.is_empty() {
                // The next round starts again at same-day reach.
                pairs.extend(found);
                break;
            }
        }
    }
    pairs
}

fn forced_in_group(
    outs: &[Vec<&Candidate>],
    ins: &[Vec<&Candidate>],
    reach: i64,
) -> Vec<(Uuid, Uuid)> {
    let links: Vec<(usize, usize)> = (0..outs.len())
        .flat_map(|o| (0..ins.len()).map(move |i| (o, i)))
        .filter(|&(o, i)| {
            let (a, b) = (outs[o][0], ins[i][0]);
            a.account_id != b.account_id && (a.day - b.day).num_days().abs() <= reach
        })
        .collect();

    // Clusters: union-find over out nodes 0..n and in nodes n..n+m.
    let n = outs.len();
    let mut parent: Vec<usize> = (0..n + ins.len()).collect();
    fn root(parent: &mut [usize], mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        x
    }
    for &(o, i) in &links {
        let (a, b) = (root(&mut parent, o), root(&mut parent, n + i));
        parent[a] = b;
    }
    let mut clusters: HashMap<usize, Vec<(usize, usize)>> = HashMap::new();
    for &(o, i) in &links {
        clusters
            .entry(root(&mut parent, o))
            .or_default()
            .push((o, i));
    }

    let mut pairs = vec![];
    for cluster_links in clusters.into_values() {
        let mut out_nodes: Vec<usize> = cluster_links.iter().map(|l| l.0).collect();
        let mut in_nodes: Vec<usize> = cluster_links.iter().map(|l| l.1).collect();
        out_nodes.sort_unstable();
        out_nodes.dedup();
        in_nodes.sort_unstable();
        in_nodes.dedup();
        let out_rows: usize = out_nodes.iter().map(|&o| outs[o].len()).sum();
        let in_rows: usize = in_nodes.iter().map(|&i| ins[i].len()).sum();

        let full = max_pairing(outs, ins, &cluster_links, None);
        if full != out_rows || full != in_rows {
            continue;
        }

        // Rows a link must carry in every complete pairing: what the cluster loses without it.
        let mut taken_out = vec![0usize; outs.len()];
        let mut taken_in = vec![0usize; ins.len()];
        for (skip, &(o, i)) in cluster_links.iter().enumerate() {
            let forced = full - max_pairing(outs, ins, &cluster_links, Some(skip));
            for _ in 0..forced {
                pairs.push((outs[o][taken_out[o]].id, ins[i][taken_in[i]].id));
                taken_out[o] += 1;
                taken_in[i] += 1;
            }
        }
    }
    pairs
}

/// The most rows `links` can pair at once, each node pairing at most as many times as it has rows;
/// `skip` leaves one link out. Max flow by augmenting paths.
fn max_pairing(
    outs: &[Vec<&Candidate>],
    ins: &[Vec<&Candidate>],
    links: &[(usize, usize)],
    skip: Option<usize>,
) -> usize {
    let mut out_left: Vec<usize> = outs.iter().map(Vec::len).collect();
    let mut in_left: Vec<usize> = ins.iter().map(Vec::len).collect();
    let mut flow = vec![0usize; links.len()];
    let mut total = 0;

    loop {
        // Breadth-first from every out node with rows to spare to any in node with room. `came_from` records
        // the link used to reach a node.
        let mut out_from: Vec<Option<usize>> = vec![None; outs.len()];
        let mut in_from: Vec<Option<usize>> = vec![None; ins.len()];
        let mut out_seen: Vec<bool> = out_left.iter().map(|&l| l > 0).collect();
        let mut queue: Vec<usize> = (0..outs.len()).filter(|&o| out_seen[o]).collect();
        let mut end = None;
        let mut head = 0;
        while head < queue.len() && end.is_none() {
            let o = queue[head];
            head += 1;
            for (k, &(lo, li)) in links.iter().enumerate() {
                if Some(k) == skip || lo != o || in_from[li].is_some() {
                    continue;
                }
                in_from[li] = Some(k);
                if in_left[li] > 0 {
                    end = Some(li);
                    break;
                }
                // Full in node: continue through a link already feeding it.
                for (k2, &(lo2, li2)) in links.iter().enumerate() {
                    if li2 == li && flow[k2] > 0 && !out_seen[lo2] {
                        out_seen[lo2] = true;
                        out_from[lo2] = Some(k2);
                        queue.push(lo2);
                    }
                }
            }
        }
        let Some(mut i) = end else {
            return total;
        };
        in_left[i] -= 1;
        loop {
            let k = in_from[i].expect("reached in node has a link");
            flow[k] += 1;
            let o = links[k].0;
            match out_from[o] {
                None => {
                    out_left[o] -= 1;
                    break;
                }
                Some(back) => {
                    flow[back] -= 1;
                    i = links[back].1;
                }
            }
        }
        total += 1;
    }
}
