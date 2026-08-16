// Karman desktop shell. The window hosts the Vite-built @karman/app bundle
// (see ../tauri.conf.json: build.frontendDist) inside the system WebView2 —
// all game logic lives in TypeScript, this binary only owns the window and
// (later) the filesystem-backed save API described in PLAN.md §6.3.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the Karman application");
}
