use chrono::{Duration, NaiveDate};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::CoreError;

/// A 4000-day line is drawn into about 800 pixels.
pub const CHART_TARGET_POINTS: usize = 400;

/// Walks BACKWARD from `to`, returned ascending, so `to` is exact (the headline net worth reads
/// it). `from` is prepended when the walk misses it, so the gain-over-range baseline isn't up to
/// `step - 1` days late; hence the cap of `target + 1`. Points are real observed days, never
/// averages.
pub fn sample_days(from: NaiveDate, to: NaiveDate, target: usize) -> Vec<NaiveDate> {
    let span = (to - from).num_days();
    if span <= 0 {
        return vec![to];
    }
    let points = (span + 1) as u64;
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

/// `range=max` is 4000 days whatever the history, so without this clamp most of a max-range
/// chart is empty days.
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
    fn long_ranges_are_capped_and_evenly_spaced() {
        let target: usize = 400;
        let from = d(2016, 1, 1);
        for span in [1i64, 399, 400, 401, 799, 800, 1300, 4000] {
            let days = sample_days(from, from + Duration::days(span), target);

            assert!(
                days.len() <= target + 1,
                "span {span}: got {} points",
                days.len()
            );
            assert_eq!(*days.first().unwrap(), from, "span {span}");

            // Every gap is the same, except the first when `from` was prepended.
            let gaps: Vec<i64> = days.windows(2).map(|w| (w[1] - w[0]).num_days()).collect();
            let step = *gaps.last().unwrap();
            assert!(
                gaps[1..].iter().all(|&g| g == step) && gaps[0] <= step,
                "span {span}: uneven gaps {gaps:?}"
            );
        }
    }

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

    #[test]
    fn never_returns_an_empty_axis() {
        let day = d(2026, 8, 24);
        assert_eq!(sample_days(day, day, 400), vec![day]);
        assert_eq!(sample_days(day + Duration::days(5), day, 400), vec![day]);
    }
}
