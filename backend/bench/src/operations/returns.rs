use super::*;
pub async fn execute(c: &PreparedCase, p: &sqlx::PgPool) -> anyhow::Result<Execution> {
    if c.case.id == "returns.inputs" {
        return timed(async { Ok(gripsou_core::repo::returns::load(p, c.fixture.user_id).await?) })
            .await;
    }
    let valid = c.case.id == "returns.xirr.valid";
    let start = c.fixture.today() - chrono::Duration::days(365);
    let flows = [
        gripsou_core::returns::Flow {
            day: start,
            amount: -100.,
        },
        gripsou_core::returns::Flow {
            day: c.fixture.today(),
            amount: if valid { 110. } else { -110. },
        },
    ];
    let t = std::time::Instant::now();
    let mut value = None;
    for _ in 0..100 {
        value = std::hint::black_box(gripsou_core::returns::xirr(std::hint::black_box(&flows)));
    }
    Ok(Execution {
        elapsed: t.elapsed(),
        rows: 1,
        outcome: serde_json::to_value(value)?,
        batch_size: 100,
    })
}
