#[cfg(not(target_os = "macos"))]
compile_error!("Stow runs on macOS.");

mod activity;
mod assistant;
mod catalog;
mod classify;
mod commands;
mod demo;
mod devtools;
mod describe;
mod disk;
mod exec;
mod guard;
mod icons;
mod info;
mod items;
mod menu;
mod model;
mod paths;
mod scanner;
mod store;
mod updates;
mod version;
mod volume;
mod window;

use std::sync::{Arc, Mutex};

use tauri::{Manager, RunEvent};

use crate::activity::Activity;
use crate::demo::is_demo;
use crate::devtools::DevTools;
use crate::icons::Icons;
use crate::scanner::Scanner;
use crate::store::{Db, Store};
use crate::updates::Updates;
use crate::window::{apply_theme, background, data_dir, install_icon, system_dark};

pub struct AppState {
    pub scanner: Scanner,
    pub icons: Arc<Icons>,
    pub updates: Arc<Mutex<Updates>>,
    pub activity: Arc<Activity>,
    pub devtools: Arc<DevTools>,
    db: Db,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let dir = data_dir(app.handle());
            std::fs::create_dir_all(&dir).map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            let store = Store::open(&dir.join("stow.sqlite")).map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            let saved = if is_demo() { None } else { store.read_scan() };
            let db = Db::new(store);
            let activity = Activity::new(app.handle().clone());
            let scanner = Scanner::new(app.handle().clone(), db.clone(), activity.clone());
            if let Some(saved) = saved {
                scanner.hydrate(saved.items);
            }
            if is_demo() {
                scanner.ready();
            } else {
                let scanner = scanner.clone();
                let db = db.clone();
                // Folder requests wait for this, so it must say ready even if a saved row cannot be read.
                std::thread::spawn(move || {
                    let folders = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| db.read(|store| store.read_folders()))).unwrap_or_default();
                    scanner.hydrate_folders(folders);
                    scanner.ready();
                });
            }
            let icons = Arc::new(Icons::new());
            let warming = icons.clone();
            std::thread::spawn(move || warming.warm());
            app.manage(AppState { scanner, icons, updates: Arc::new(Mutex::new(Updates::new())), activity, devtools: Arc::new(DevTools::new()), db });
            menu::install_menu(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(background(system_dark())));
                let _ = apply_theme(&window, "system");
            }
            install_icon(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::meta,
            commands::get_volume,
            commands::load_scan,
            commands::empty_trash,
            commands::scan,
            commands::reveal,
            commands::trash,
            commands::trash_many,
            commands::open_folder,
            commands::go_to,
            commands::pick_folder,
            commands::info,
            commands::set_theme,
            commands::check_update,
            commands::download_update,
            commands::install_update,
            commands::open_release_page,
            commands::file_icons,
            commands::ask,
            commands::activity,
            commands::dev_tools,
            commands::clean_dev_tool,
        ])
        .build(tauri::generate_context!())
        .expect("error while running Stow")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(state) = app.try_state::<AppState>() {
                    state.scanner.stop();
                    state.icons.stop();
                    state.devtools.stop();
                }
            }
        });
}
