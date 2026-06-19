//! Global app settings reads and writes.

use crate::error::CoreError;

/// Returns the current list of CORS origins allowed.
pub async fn cors_origins(pool: &sqlx::PgPool) -> Result<Vec<String>, CoreError> {
    let row = sqlx::query!(
        r#"
        select cors_origins
        from app_settings
        where id = 1
        "#,
    )
    .fetch_one(pool)
    .await?;
    Ok(row.cors_origins)
}

/// Overwrites the list of CORS origins.
pub async fn set_cors_origins(pool: &sqlx::PgPool, origins: &[String]) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        update app_settings
        set cors_origins = $1
        where id = 1
        "#,
        origins,
    )
    .execute(pool)
    .await?;
    Ok(())
}
