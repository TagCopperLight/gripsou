//! Writes the API's TypeScript types to `frontend/src/api/wire.ts`
//! (`gripsou_api::wire_ts`).
//!
//!     cargo run -p gripsou-api --example wire-types

fn main() -> std::io::Result<()> {
    std::fs::write(gripsou_api::wire_ts::PATH, gripsou_api::wire_ts::render())
}
