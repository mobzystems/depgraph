// Prevents additional console window on Windows in release, DO NOT REMOVE!!
 #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//  // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
// #[tauri::command]
// fn greet(name: &str) -> String {
//     format!("Hello, {}! You've been greeted from Rust!", name)
// }

#[tauri::command]
fn read_all_text(name: &str) -> String {
    std::fs::read_to_string(name).unwrap()
}

#[tauri::command]
fn file_exists(name: &str) -> bool {
    let path = std::path::Path::new(name);
    path.exists()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![file_exists, read_all_text])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
