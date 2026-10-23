use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};

use crate::model::app_version;

pub fn install_menu(app: &AppHandle) -> tauri::Result<()> {
    let check = MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?;
    let about = PredefinedMenuItem::about(
        app,
        None,
        Some(AboutMetadata {
            name: Some("Stow".into()),
            version: Some(app_version()),
            copyright: Some("Scanning stays on this Mac.".into()),
            ..Default::default()
        }),
    )?;
    let app_menu = Submenu::with_items(
        app,
        "Stow",
        true,
        &[
            &about,
            &check,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let menu = Menu::with_items(app, &[&app_menu, &edit, &window])?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == "check-updates" {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("update:requested", ());
            }
        }
    });
    Ok(())
}
