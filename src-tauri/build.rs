fn main() {
    let dist = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../dist");
    let _ = std::fs::create_dir_all(&dist);
    let index = dist.join("index.html");
    if !index.exists() {
        let _ = std::fs::write(
            index,
            "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
        );
    }
    tauri_build::build()
}
