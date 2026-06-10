use gripsou_core::db::Db;

pub async fn run_scheduler(_db: Db) {
    tracing::info!("scheduler stub: no jobs registered yet");
}
