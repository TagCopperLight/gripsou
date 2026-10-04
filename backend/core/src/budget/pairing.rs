//! The budget pairing pass, run inside every ingest: find the two halves of a movement
//! between the user's own accounts and mark them as one internal transfer, so
//! they stop showing up as income and expense in every chart.
//!
//! The matching rule is deliberately timid. A false pair silently deletes real
//! spending from the Sankey and every total; an unpaired row costs the user one
//! correction. So: mutual nearest neighbour only, and **a tie pairs nothing**
//! — unless the tied rows are interchangeable and as many on each side, which
//! pair one-to-one. What that leaves gets one more look: a cluster whose rows
//! can *all* be paired off, and only in one way (a chain through a middle
//! account), pairs that way — see [`forced_pairs`]. Which rows are
//! candidates at all — transfers, plus whatever the user already filed as
//! counting toward nothing — is the candidate query's business.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

/// How far apart the two halves may sit. Three days covered a weekend
/// transfer that clears on Monday; five also catches a card top-up of another
/// account that settles a few days after the top-up lands, and on real data
/// let through no wrong pair the narrower window had kept out.
const WINDOW_DAYS: i64 = 5;

struct Candidate {
    id: Uuid,
    account_id: Uuid,
    ts: DateTime<Utc>,
    amount: Decimal,
    currency: String,
}

/// Two candidates that could be swapped for each other in a nearest-neighbour
/// tie without changing the outcome: every candidate is a transfer and callers
/// only compare rows already sharing currency, amount and sign, so two on the
/// same account are the same movement as far as any total can tell — whatever
/// their date. [`forced_pairs`] merges rows on a stricter test (same account
/// *and* same instant), because it measures reach from one timestamp per node.
fn interchangeable(a: &Candidate, b: &Candidate) -> bool {
    a.account_id == b.account_id
}

/// Works out this user's internal-transfer pairs from scratch, writes what
/// changed, and returns how many pairs it wrote.
///
/// From scratch, so a correction always takes effect: once the user files the
/// row that was blocking a pair (an outside wallet's top-up that tied with a
/// real transfer), or one that was wrongly paired, the next run sees the
/// ledger as it is now rather than building on what an earlier run decided.
/// Every candidate is read — paired or not — and matched again; then only the
/// difference is written. A pair that no longer holds is unlinked, and a half
/// whose category pairing set goes back to uncategorised, as if never paired;
/// a category someone chose stays. A run that finds the pairs already there
/// writes nothing. At a few thousand rows this is one read and, usually, no
/// write.
///
/// A single round of mutual-nearest-neighbour matching can leave true pairs on
/// the table: if X's nearest is Y but Y's own nearest is some other row W,
/// neither X-Y nor X-W pairs that round, even though removing Y (paired off
/// with W) may make W's former runner-up X's new, uncontested nearest match.
/// So rounds repeat until one pairs nothing. The candidates are read once and
/// the rounds run in memory, each removing the rows it paired, so the pool
/// strictly shrinks and the loop always terminates; every pair is then
/// written in one statement.
///
/// A category the user chose is never changed: a row they filed in a neutral
/// category may gain or lose a partner, but keeps that category.
///
/// The caller must hold this user's advisory lock (`ingest` takes it at the
/// top of its transaction). This pass reads and writes across every account
/// the user owns, and two connections of one user syncing at once would
/// otherwise take row locks in opposite orders and deadlock.
pub async fn pair_internal_transfers(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
) -> Result<usize, CoreError> {
    let rows = sqlx::query!(
        r#"
        select t.id          as "id!",
               t.account_id  as "account_id!",
               t.ts          as "ts!",
               t.amount      as "amount!",
               a.currency    as "currency!",
               t.transfer_pair_id
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        left join budget_category c on c.id = t.budget_category_id
        where k.user_id = $1
          and t.amount <> 0
          -- The cash leg of a buy/sell is the lot's record, already out of
          -- every budget total, and it mirrors across a broker's cash and
          -- portfolio accounts: pairing those copies would mean nothing.
          and not budget_investment_leg(t.type)
          and (
              -- A transfer whose category pairing may still decide: an empty
              -- slot, an AI guess nobody has looked at yet, or a row whose
              -- partner went away. A category the user chose (set, or an AI
              -- guess accepted in review) is theirs.
              --
              -- Only transfers: matching is by amount and date alone, so any
              -- other type lets a coincidence through — a card payment equal
              -- to a top-up arriving on another account, a friend's deposit
              -- equal to a transfer leaving, a dividend matched with its own
              -- mirror on a broker's other account. Measured on real data,
              -- opening this to every type paired more coincidences than
              -- transfers, and the extra rows' ties blocked good pairs.
              (t.type = 'transfer'
               and (t.category_source is null
                    -- Set by pairing: paired now (to be matched again), or
                    -- the half left when the user recategorised its partner.
                    or t.category_source = 'pair'
                    or (t.category_source = 'ai' and t.category_reviewed_at is null)))
              -- Any row, of any type and whoever filed it, already in a
              -- neutral category: someone said it counts toward nothing, so
              -- pairing it hides nothing that was counted. This is what
              -- catches a real transfer the provider labels a deposit or a
              -- card payment, once the user has filed it.
              or c.kind = 'neutral'
          )
        order by t.ts
        "#,
        user_id,
    )
    .fetch_all(&mut *conn)
    .await?;

    let current: HashMap<Uuid, Option<Uuid>> =
        rows.iter().map(|r| (r.id, r.transfer_pair_id)).collect();
    let mut candidates: Vec<Candidate> = rows
        .into_iter()
        .map(|r| Candidate {
            id: r.id,
            account_id: r.account_id,
            ts: r.ts,
            amount: r.amount,
            currency: r.currency,
        })
        .collect();

    let mut pairs: Vec<(Uuid, Uuid)> = vec![];
    loop {
        let mut round = nearest_pairs(&candidates);
        // Nearest-neighbour matching has converged. What it leaves is mostly
        // chains through a middle account (savings → deposit → checking account
        // the same day): every row ties there, yet only one pairing explains
        // them all. Tried only once the rounds above stop finding pairs, so
        // the nearest-in-time preference always gets first say.
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

    // Both directions of every pair: each row points at its partner.
    let links: Vec<(Uuid, Uuid)> = pairs.iter().flat_map(|&(o, i)| [(o, i), (i, o)]).collect();
    let kept: Vec<Uuid> = links.iter().map(|&(id, _)| id).collect();

    // Pairs this run did not find again. Every paired row is a candidate (its
    // category is pairing's, or neutral: a write to anything else unlinks
    // it), but the statement doesn't rely on that and takes every paired row
    // of the user's outside `kept`. Clearing the source in the same statement
    // keeps the partner-deleted trigger out of it.
    sqlx::query!(
        r#"
        update transaction t
           set transfer_pair_id = null,
               budget_category_id = case when t.category_source = 'pair'
                                         then null else t.budget_category_id end,
               category_source = case when t.category_source = 'pair'
                                      then null else t.category_source end
          from account a
          join connection k on k.id = a.connection_id
         where a.id = t.account_id
           and k.user_id = $1
           and t.transfer_pair_id is not null
           and not (t.id = any($2))
        "#,
        user_id,
        &kept,
    )
    .execute(&mut *conn)
    .await?;

    // Only links that are new or moved get written.
    let (ids, partners): (Vec<Uuid>, Vec<Uuid>) = links
        .into_iter()
        .filter(|(id, partner)| current.get(id).copied().flatten() != Some(*partner))
        .unzip();
    if ids.is_empty() {
        return Ok(0);
    }
    // A category the user chose (set, or accepted in review) is kept: only
    // the link is added. Every other row becomes a pairing-set internal
    // transfer, and the AI's confidence and review stamp go with the guess
    // they described — left behind they would read as a reviewed transfer at
    // 27 %.
    let result = sqlx::query!(
        r#"
        update transaction t
           set transfer_pair_id = p.partner,
               budget_category_id = case when o.user_chose then t.budget_category_id else c.id end,
               category_source = case when o.user_chose then t.category_source else 'pair' end,
               category_confidence = case when o.user_chose then t.category_confidence end,
               category_reviewed_at = case when o.user_chose then t.category_reviewed_at end
          from unnest($1::uuid[], $2::uuid[]) as p(id, partner)
          join lateral (
              select x.category_source = 'user' or x.category_reviewed_at is not null as user_chose
              from transaction x
              where x.id = p.id
          ) o on true,
               budget_category c
         where t.id = p.id
           and c.user_id = $3
           and c.system_key = 'internal_transfer'
        "#,
        &ids,
        &partners,
        user_id,
    )
    .execute(&mut *conn)
    .await?;

    // A write that doesn't touch every row is a hard error rather than a
    // half-paired ledger: if the join above matched nothing (this user's
    // `internal_transfer` category missing), pairs would be reported that
    // were never written.
    if result.rows_affected() != ids.len() as u64 {
        return Err(CoreError::TransferPairNotWritten {
            user_id,
            out_id: ids[0],
            in_id: partners[0],
            rows: result.rows_affected(),
        });
    }
    // A moved pair writes both of its rows, as a new one does.
    Ok(ids.len() / 2)
}

/// One round: every mutual-nearest-neighbour pair among `candidates`. See
/// [`pair_internal_transfers`] for why this needs to repeat.
fn nearest_pairs(candidates: &[Candidate]) -> Vec<(Uuid, Uuid)> {
    // Group by (currency, |amount|): only rows inside one group can ever pair,
    // which keeps the comparison quadratic in the size of a group rather than
    // of the ledger.
    let mut groups: HashMap<(&str, Decimal), Vec<&Candidate>> = HashMap::new();
    for c in candidates {
        groups
            .entry((c.currency.as_str(), c.amount.abs()))
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

    pairs
}

/// Pairs that every consistent explanation of a cluster agrees on.
///
/// Rows sharing currency and amount are linked when they could be two halves
/// of one transfer (opposite signs, different accounts, within reach in
/// time). A cluster of linked rows is acted on only when *every* row in it
/// can be paired off — a leftover row means one of them is money leaving or
/// arriving from outside, and nothing says which, so nothing pairs. Within
/// such a cluster, a link pairs only when no complete pairing of the cluster
/// can do without it.
///
/// Reach grows a day at a time up to [`WINDOW_DAYS`], so same-day chains are
/// settled before a wider window could tangle them with the next day's.
///
/// Rows on one account at one instant are identical for this purpose, so
/// they are counted as one node of that many rows: two identical chains the
/// same day pair, where treating each row apart would see two equally good
/// ways to do it and pair nothing. Stricter than [`interchangeable`], which
/// ignores the date: a node's reach is measured from its single timestamp.
fn forced_pairs(candidates: &[Candidate]) -> Vec<(Uuid, Uuid)> {
    let mut groups: HashMap<(&str, Decimal), Vec<&Candidate>> = HashMap::new();
    for c in candidates {
        groups
            .entry((c.currency.as_str(), c.amount.abs()))
            .or_default()
            .push(c);
    }

    let mut pairs = vec![];
    for group in groups.into_values() {
        // Nodes: identical rows, each list sorted by id so both runs
        // of a converged pass pick the same rows.
        let mut outs: Vec<Vec<&Candidate>> = vec![];
        let mut ins: Vec<Vec<&Candidate>> = vec![];
        let mut by_key: HashMap<(bool, Uuid, DateTime<Utc>), usize> = HashMap::new();
        for c in group {
            let side = if c.amount < Decimal::ZERO {
                &mut outs
            } else {
                &mut ins
            };
            let slot = *by_key
                .entry((c.amount < Decimal::ZERO, c.account_id, c.ts))
                .or_insert_with(|| {
                    side.push(vec![]);
                    side.len() - 1
                });
            side[slot].push(c);
        }
        for node in outs.iter_mut().chain(ins.iter_mut()) {
            node.sort_by_key(|c| c.id);
        }

        for days in 0..=WINDOW_DAYS {
            let reach = chrono::Duration::days(days).num_seconds();
            let found = forced_in_group(&outs, &ins, reach);
            if !found.is_empty() {
                // The next round starts again at same-day reach on what is
                // left.
                pairs.extend(found);
                break;
            }
        }
    }
    pairs
}

/// [`forced_pairs`] for one currency-and-amount group at one reach.
fn forced_in_group(
    outs: &[Vec<&Candidate>],
    ins: &[Vec<&Candidate>],
    reach: i64,
) -> Vec<(Uuid, Uuid)> {
    let links: Vec<(usize, usize)> = (0..outs.len())
        .flat_map(|o| (0..ins.len()).map(move |i| (o, i)))
        .filter(|&(o, i)| {
            let (a, b) = (outs[o][0], ins[i][0]);
            a.account_id != b.account_id && (a.ts - b.ts).num_seconds().abs() <= reach
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

        // How many rows a link must carry in every complete pairing: what
        // the cluster loses when that link is taken away.
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

/// The most rows `links` can pair at once, each node pairing at most as many
/// times as it has rows; `skip` leaves one link out. A max flow by
/// augmenting paths — clusters are a handful of nodes, so nothing cleverer is
/// worth it.
fn max_pairing(
    outs: &[Vec<&Candidate>],
    ins: &[Vec<&Candidate>],
    links: &[(usize, usize)],
    skip: Option<usize>,
) -> usize {
    let mut out_left: Vec<usize> = outs.iter().map(Vec::len).collect();
    let mut in_left: Vec<usize> = ins.iter().map(Vec::len).collect();
    // Rows currently sent along each link; undone when a path walks it back.
    let mut flow = vec![0usize; links.len()];
    let mut total = 0;

    loop {
        // Breadth-first from every out node with rows to spare, towards any
        // in node with room. `came_from` records the link used to reach an
        // in node (forwards) or an out node (backwards, undoing flow).
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
