//! The day axis a chart is computed over: clamped to real history, then
//! sampled to a roughly constant number of points.

use chrono::{Duration, NaiveDate};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::CoreError;

/// Roughly how many points a chart should carry, whatever its range. A 4000-day
/// line is drawn into about 800 pixels — five points per pixel of payload,
/// parsing and rendering, for a line nobody can see the detail of.
pub const CHART_TARGET_POINTS: usize = 400;

/// The days a chart is computed on: at most `target + 1` of them, walking
/// BACKWARD from `to`, returned ascending.
///
/// Backward, not forward, so `to` is always the final point and is exact — the
/// headline current-net-worth figure reads it, and a forward walk would leave
/// that figure on a stale sampled day. The cost is that the oldest partial
/// interval is dropped rather than half-sampled, which is invisible on a chart
/// and cannot mislead.
///
/// `from` is always the first point too, prepended if the backward walk didn't
/// already land on it exactly. This is the same symmetry that makes `to`
/// exact: the "gain over range" figure reads `first()`, and without this a
/// max-range chart's baseline could drift up to `step - 1` days late. The cap
/// is `target + 1` rather than `target` to make room for this one extra point.
///
/// Points are real observed days, never averages: a sampled point is that day's
/// actual value, so peaks stay where they are.
pub fn sample_days(from: NaiveDate, to: NaiveDate, target: usize) -> Vec<NaiveDate> {
    let span = (to - from).num_days();
    if span <= 0 {
        return vec![to];
    }
    let points = (span + 1) as u64;
    // ceil(points / target), never zero.
    let step = match target as u64 {
        0 => points,
        t => points.div_ceil(t).max(1),
    } as i64;

    let mut days = Vec::new();
    let mut d = to;
    while d >= from {
        days.push(d);
        d -= Duration::days(step);
    }
    days.reverse();
    if days.first() != Some(&from) {
        days.insert(0, from);
    }
    days
}

/// The first day this user has any holding data for. `None` when they have
/// none at all.
///
/// `range=max` means 4000 days regardless of how much history exists, so
/// without this clamp roughly two thirds of a max-range chart is empty days
/// generated, valued, joined, serialised and drawn.
pub async fn history_start(pool: &PgPool, user_id: Uuid) -> Result<Option<NaiveDate>, CoreError> {
    let row = sqlx::query_scalar!(
        r#"
        select min(hp.as_of) as "min_as_of?"
        from holding_point hp
        join holding h    on h.id = hp.holding_id
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where c.user_id = $1
        "#,
        user_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn short_ranges_stay_daily() {
        let days = sample_days(d(2026, 8, 1), d(2026, 8, 10), 400);
        assert_eq!(days.len(), 10);
        assert_eq!(days.first(), Some(&d(2026, 8, 1)));
        assert_eq!(days.last(), Some(&d(2026, 8, 10)));
    }

    #[test]
    fn stride_is_uniform_and_matches_the_computed_step() {
        let target: usize = 400;
        let from = d(2016, 1, 1);
        for span in [1i64, 399, 400, 401, 799, 800, 1300, 4000] {
            let to = from + Duration::days(span);
            let days = sample_days(from, to, target);

            // The honest general cap: at most target+1 points. The +1 covers
            // Finding 4's prepended `from`, needed when the backward walk
            // from `to` doesn't already land exactly on `from`.
            assert!(
                days.len() <= target + 1,
                "span {span}: got {} points",
                days.len()
            );

            // `from` is always exactly the first point (Finding 4).
            assert_eq!(*days.first().unwrap(), from, "span {span}");

            // Independently recompute the step sample_days uses, and the
            // length of the pure backward walk from `to`.
            let points = (span + 1) as u64;
            let step = points.div_ceil(target as u64).max(1) as i64;
            let walked_len = (span / step + 1) as usize;
            assert!(
                days.len() == walked_len || days.len() == walked_len + 1,
                "span {span}: got {} points, expected {walked_len} or {}",
                days.len(),
                walked_len + 1
            );

            // The walked tail (everything except a possible prepended
            // `from`) has uniform stride equal to that independently
            // computed step.
            let tail = &days[days.len() - walked_len..];
            assert!(
                tail.windows(2).all(|w| (w[1] - w[0]).num_days() == step),
                "span {span}: stride is not uniform, expected {step} days"
            );
        }
    }

    /// The headline current-net-worth figure reads the last point. Sampling
    /// forward from `from` would leave it on a stale day.
    #[test]
    fn the_last_point_is_always_the_end_date() {
        for span in [1i64, 7, 365, 4000] {
            let to = d(2026, 8, 24);
            let days = sample_days(to - Duration::days(span), to, 400);
            assert_eq!(days.last(), Some(&to), "span {span}");
        }
    }

    #[test]
    fn days_are_ascending_and_unique() {
        let days = sample_days(d(2016, 1, 1), d(2026, 12, 31), 400);
        let mut sorted = days.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(days, sorted);
    }

    /// Never empty, even when from == to, or when from is after to (which a
    /// clamp against a user with no history can produce).
    #[test]
    fn never_returns_an_empty_axis() {
        let day = d(2026, 8, 24);
        assert_eq!(sample_days(day, day, 400), vec![day]);
        assert_eq!(sample_days(day + Duration::days(5), day, 400), vec![day]);
    }

    #[test]
    fn a_target_of_zero_does_not_divide_by_zero() {
        // target 0 still walks to a single point at `to` — but `from` gets
        // prepended per Finding 4, same as any other target.
        let days = sample_days(d(2026, 1, 1), d(2026, 12, 31), 0);
        assert_eq!(days, vec![d(2026, 1, 1), d(2026, 12, 31)]);
    }
}
