fn main() -> std::io::Result<()> {
    std::fs::write(gripsou_api::wire_ts::PATH, gripsou_api::wire_ts::render())?;
    std::fs::write(gripsou_api::routes::PATH, gripsou_api::routes::render())
}
