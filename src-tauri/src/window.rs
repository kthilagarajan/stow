use std::path::PathBuf;
use std::process::Command;

use tauri::Manager;

pub fn icon_path() -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../build/icon.png")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("../Resources/icon.png"));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

pub fn system_dark() -> bool {
    let Ok(output) = Command::new("defaults").args(["read", "-g", "AppleInterfaceStyle"]).output() else {
        return false;
    };
    output.status.success() && String::from_utf8_lossy(&output.stdout).to_lowercase().contains("dark")
}

pub fn background(dark: bool) -> tauri::window::Color {
    if dark {
        tauri::window::Color(0x0E, 0x15, 0x20, 255)
    } else {
        tauri::window::Color(0xE4, 0xED, 0xF6, 255)
    }
}

pub fn data_dir(_app: &tauri::AppHandle) -> PathBuf {
    if crate::demo::is_demo() {
        std::env::temp_dir().join("stow-demo")
    } else {
        let home = crate::paths::home_dir();
        PathBuf::from(home).join("Library/Application Support/Stow")
    }
}

pub fn apply_theme(window: &tauri::WebviewWindow, choice: &str) {
    let theme = match choice {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    };
    let _ = window.set_theme(theme);
    let dark = match choice {
        "dark" => true,
        "light" => false,
        _ => window.theme().map(|theme| theme == tauri::Theme::Dark).unwrap_or_else(|_| system_dark()),
    };
    let _ = window.set_background_color(Some(background(dark)));
}

pub fn install_icon(app: &tauri::AppHandle) {
    let Some(path) = icon_path() else { return };
    let Ok(image) = tauri::image::Image::from_path(&path) else { return };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_icon(image);
    }
}
