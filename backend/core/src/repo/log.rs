//! The saved-log table. Written only by `logs::writer`, purged by the daily
//! `logs` sweep.

use crate::error::CoreError;
use crate::logs::LogLine;

/// One multi-row insert for the whole batch.
pub async fn insert_batch(db: &sqlx::PgPool, lines: &[LogLine]) -> Result<u64, CoreError> {
    if lines.is_empty() {
        return Ok(0);
    }
    let at: Vec<_> = lines.iter().map(|l| l.at).collect();
    let level: Vec<String> = lines.iter().map(|l| l.level.to_string()).collect();
    let target: Vec<String> = lines.iter().map(|l| l.target.clone()).collect();
    let message: Vec<String> = lines.iter().map(|l| l.message.clone()).collect();
    let fields: Vec<serde_json::Value> = lines.iter().map(|l| l.fields.clone()).collect();
    let r = sqlx::query!(
        "insert into log (at, level, target, message, fields)
         select * from unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])",
        &at,
        &level,
        &target,
        &message,
        &fields,
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected())
}

/// Delete rows older than `days`. Returns how many were deleted.
pub async fn purge_older_than(db: &sqlx::PgPool, days: i32) -> Result<u64, CoreError> {
    let r = sqlx::query!(
        "delete from log where at < now() - make_interval(days => $1)",
        days
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected())
}
