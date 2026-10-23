use std::path::Path;
use tokio::{sync::oneshot, task::JoinHandle};
/// The token never enters a report; only private request/child transports use it.
pub struct ServerHandle {
    url: String,
    token: String,
    shutdown: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<std::io::Result<()>>>,
}
impl ServerHandle {
    pub async fn start(
        pool: &sqlx::PgPool,
        user: uuid::Uuid,
        static_dir: &Path,
    ) -> anyhow::Result<Self> {
        let token = gripsou_api::auth::generate_token();
        gripsou_core::repo::session::create(
            pool,
            user,
            &gripsou_api::auth::hash_token(&token),
            Some("Benchmark"),
            Some("127.0.0.1"),
            false,
            chrono::Utc::now() + chrono::Duration::hours(4),
        )
        .await?;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let url = format!("http://{}", listener.local_addr()?);
        // Benchmarks never decrypt a second factor; any valid key will do.
        let key = gripsou_api::TotpKey::parse(Some(&"0".repeat(64))).map_err(anyhow::Error::msg)?;
        let passkeys = gripsou_api::Passkeys::parse(Some("http://localhost:5173"))
            .map_err(anyhow::Error::msg)?;
        let app = gripsou_api::router(pool.clone(), static_dir, vec![], key, passkeys);
        let (tx, rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await
        });
        Ok(Self {
            url,
            token,
            shutdown: Some(tx),
            task: Some(task),
        })
    }
    pub fn url(&self) -> &str {
        &self.url
    }
    pub fn token(&self) -> &str {
        &self.token
    }
    pub async fn shutdown(mut self) -> anyhow::Result<()> {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(task) = self.task.take() {
            task.await??;
        }
        Ok(())
    }
}
impl Drop for ServerHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}
