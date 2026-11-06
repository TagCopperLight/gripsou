//! Writes the API's TypeScript types to `frontend/src/api/wire.ts`
//! (`gripsou_api::wire_ts`) and its route list to `frontend/src/api/routes.ts`
//! (`gripsou_api::routes`).
//!
//!     cargo run -p gripsou-api --example wire-types

fn main() -> std::io::Result<()> {
    std::fs::write(gripsou_api::wire_ts::PATH, gripsou_api::wire_ts::render())?;
    std::fs::write(gripsou_api::routes::PATH, gripsou_api::routes::render())
}
