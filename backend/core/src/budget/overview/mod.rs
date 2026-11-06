//! The Budget Overview: the summary and the trend chart, each read in one
//! fetch of `repo::budget::summary::day_category_totals` and reduced by
//! [`calc`].

pub mod calc;

use uuid::Uuid;

use crate::error::CoreError;
use crate::repo::budget::{category, summary::day_category_totals};
use calc::{Month, Period, Summary, Trend};

/// The Overview of `period`. One fetch covers the period and, for a month,
/// its baseline, so no figure on the page can disagree with another.
pub async fn summary(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    period: Period,
) -> Result<Summary, CoreError> {
    let (from, to) = period.window();
    let rows = day_category_totals(pool, user_id, from, to).await?;
    Ok(calc::summarise(&rows, period))
}

/// `months` bars of expenses ending at and including `anchor`. `months` is
/// at least 1.
pub async fn trend_for(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    anchor: Month,
    months: u32,
) -> Result<Trend, CoreError> {
    let from = anchor.minus(months - 1).bounds().0;
    let to = anchor.bounds().1;
    let rows = day_category_totals(pool, user_id, from, to).await?;
    let fold = category::catch_all_expense(pool, user_id).await?;
    Ok(calc::trend(&rows, anchor, months, fold))
}
