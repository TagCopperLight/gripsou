//! Resolve "the current user". Auth is not built yet, so this returns the
//! single seeded dev user. When real auth lands, only this function changes —
//! query shapes already take a user_id.

use sqlx::PgPool;
use uuid::Uuid;

pub async fn current_user(pool: &PgPool) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(r#"select id from users order by created_at limit 1"#)
        .fetch_one(pool)
        .await
}
