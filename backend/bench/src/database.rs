use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use sqlx::{AssertSqlSafe, Executor, PgPool};
use std::path::PathBuf;
pub fn database_url(base: &str, name: &str) -> Result<String> {
    let mut url = url::Url::parse(base).map_err(|_| anyhow::anyhow!("invalid database URL"))?;
    ensure!(
        matches!(url.scheme(), "postgres" | "postgresql"),
        "PostgreSQL URL required"
    );
    url.set_path(&format!("/{name}"));
    Ok(url.to_string())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    run: String,
    databases: Vec<String>,
}
pub struct ScratchRun {
    base: String,
    admin: PgPool,
    manifest: Manifest,
    pub manifest_path: PathBuf,
    pools: Vec<(String, PgPool)>,
}
impl ScratchRun {
    pub async fn new(base: &str) -> Result<Self> {
        let run = uuid::Uuid::new_v4().simple().to_string();
        let manifest_path = std::env::temp_dir().join(format!("gripsou-bench-{run}.json"));
        let admin = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&database_url(base, "postgres")?)
            .await?;
        let s = Self {
            base: base.into(),
            admin,
            manifest: Manifest {
                version: 1,
                run,
                databases: vec![],
            },
            manifest_path,
            pools: vec![],
        };
        s.persist()?;
        Ok(s)
    }
    fn persist(&self) -> Result<()> {
        crate::report::write_atomic(&self.manifest_path, &self.manifest)
    }
    pub async fn create_db(&mut self, template: Option<&str>) -> Result<(String, PgPool)> {
        if let Some(t) = template {
            ensure!(
                self.manifest.databases.iter().any(|d| d == t),
                "template is not owned by this run"
            );
            self.verify_owner(t).await?;
        }
        let name = format!("bench_{}", uuid::Uuid::new_v4().simple());
        let sql = match template {
            Some(t) => format!("create database \"{name}\" template \"{t}\""),
            None => format!("create database \"{name}\" template template0"),
        };
        self.admin.execute(AssertSqlSafe(sql)).await?;
        self.manifest.databases.push(name.clone());
        self.persist()?;
        self.admin
            .execute(AssertSqlSafe(format!(
                "comment on database \"{name}\" is 'gripsou-bench:{}'",
                self.manifest.run
            )))
            .await?;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(10)
            .connect(&database_url(&self.base, &name)?)
            .await?;
        self.pools.push((name.clone(), pool.clone()));
        if template.is_none() {
            sqlx::migrate!("../migrations").run(&pool).await?;
        }
        Ok((name, pool))
    }
    async fn verify_owner(&self, name: &str) -> Result<()> {
        ensure!(
            name.starts_with("bench_")
                && name[6..].len() == 32
                && name[6..].bytes().all(|b| b.is_ascii_hexdigit()),
            "invalid owned database name"
        );
        let marker: Option<String> = sqlx::query_scalar(
            "select shobj_description(oid,'pg_database') from pg_database where datname=$1",
        )
        .bind(name)
        .fetch_optional(&self.admin)
        .await?
        .flatten();
        ensure!(
            marker.as_deref() == Some(&format!("gripsou-bench:{}", self.manifest.run)),
            "database ownership marker does not match manifest"
        );
        Ok(())
    }
    pub async fn remove_db(&mut self, name: &str) -> Result<()> {
        ensure!(
            self.manifest.databases.iter().any(|d| d == name),
            "database is absent from manifest"
        );
        self.verify_owner(name).await?;
        for (n, p) in &self.pools {
            if n == name {
                p.close().await;
            }
        }
        self.admin
            .execute(AssertSqlSafe(format!(
                "drop database \"{name}\" with (force)"
            )))
            .await?;
        self.pools.retain(|(n, _)| n != name);
        self.manifest.databases.retain(|n| n != name);
        self.persist()?;
        Ok(())
    }
    pub async fn cleanup(&mut self) -> Result<()> {
        let mut errors = Vec::new();
        for n in self.manifest.databases.clone().into_iter().rev() {
            if let Err(e) = self.remove_db(&n).await {
                errors.push(e.to_string());
            }
        }
        self.admin.close().await;
        ensure!(
            errors.is_empty(),
            "cleanup failed: {} (manifest {})",
            errors.join("; "),
            self.manifest_path.display()
        );
        std::fs::remove_file(&self.manifest_path)?;
        Ok(())
    }
    pub async fn cleanup_manifest(base: &str, path: PathBuf) -> Result<()> {
        let manifest: Manifest = crate::report::read(&path)?;
        ensure!(
            manifest.version == 1 && uuid::Uuid::parse_str(&manifest.run).is_ok(),
            "invalid run manifest"
        );
        let admin = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&database_url(base, "postgres")?)
            .await?;
        let mut s = Self {
            base: base.into(),
            admin,
            manifest,
            manifest_path: path,
            pools: vec![],
        };
        s.cleanup().await
    }
}
