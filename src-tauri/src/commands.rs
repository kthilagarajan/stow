use serde::Serialize;
use tauri::{AppHandle, State};

use crate::assistant::open_assistant;
use crate::demo::{self, is_demo};
use crate::info::item_info;
use crate::model::{AppMeta, AssistantResult, FolderResult, TrashBatchResult, TrashResult, UpdateResult, app_version};
use crate::volume::read_volume;
use crate::window::apply_theme;
use crate::activity::ActivityTask;
use crate::AppState;

async fn off_main<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.map_err(|error| error.to_string())
}

pub fn string_arg(value: Option<&serde_json::Value>) -> Option<&str> {
    value.and_then(|value| value.as_str())
}

#[tauri::command(rename = "meta")]
pub fn meta() -> AppMeta {
    AppMeta { version: app_version() }
}

#[tauri::command(rename = "getVolume")]
pub async fn get_volume(state: State<'_, AppState>) -> Result<crate::model::VolumeInfo, String> {
    if is_demo() {
        return Ok(demo::demo_volume());
    }
    let _busy = state.activity.begin("volume", None);
    off_main(read_volume).await?
}

#[tauri::command(rename = "loadScan")]
pub async fn load_scan(state: State<'_, AppState>) -> Result<Option<crate::model::SavedScan>, String> {
    if is_demo() {
        return Ok(Some(demo::demo_scan()));
    }
    let _busy = state.activity.begin("saved", None);
    let db = state.db.clone();
    off_main(move || db.read(|store| store.read_scan())).await
}

#[tauri::command(rename = "emptyTrash")]
pub async fn empty_trash(state: State<'_, AppState>) -> Result<TrashResult, String> {
    if is_demo() {
        return Ok(TrashResult::err("Demo mode does not move files."));
    }
    let result = state.scanner.empty_trash().await;
    if result.ok {
        state.db.write(|store| store.clear_measured_trash());
    }
    Ok(result)
}

#[derive(Serialize)]
pub struct Started {
    started: bool,
}

#[tauri::command(rename = "scan")]
pub async fn scan(state: State<'_, AppState>) -> Result<Started, String> {
    if is_demo() {
        return Ok(Started { started: false });
    }
    Ok(Started { started: state.scanner.start().await })
}

#[tauri::command(rename = "reveal")]
pub async fn reveal(state: State<'_, AppState>, path: Option<serde_json::Value>) -> Result<(), String> {
    if is_demo() {
        return Ok(());
    }
    let Some(path) = string_arg(path.as_ref()) else { return Ok(()) };
    if path.is_empty() || path.len() > 4096 || path.contains('\0') {
        return Ok(());
    }
    state.scanner.reveal(path).await;
    Ok(())
}

#[tauri::command(rename = "trash")]
pub async fn trash(state: State<'_, AppState>, path: Option<serde_json::Value>) -> Result<TrashResult, String> {
    if is_demo() {
        return Ok(TrashResult::err("Demo mode does not move files."));
    }
    let Some(path) = string_arg(path.as_ref()) else {
        return Ok(TrashResult::err("That path is not one Stow measured."));
    };
    if path.is_empty() || path.len() > 4096 || path.contains('\0') {
        return Ok(TrashResult::err("That path is not one Stow measured."));
    }
    Ok(state.scanner.trash(path).await)
}

#[tauri::command(rename = "trashMany")]
pub async fn trash_many(state: State<'_, AppState>, paths: Option<serde_json::Value>) -> Result<TrashBatchResult, String> {
    if is_demo() {
        return Ok(TrashBatchResult { trashed: Vec::new(), error: Some("Demo mode does not move files.".to_string()), sizes: Some(std::collections::BTreeMap::new()) });
    }
    let Some(paths) = paths.as_ref().and_then(|value| value.as_array()) else {
        return Ok(TrashBatchResult { trashed: Vec::new(), error: Some("Nothing was selected.".to_string()), sizes: None });
    };
    let paths = paths.iter().filter_map(|entry| entry.as_str().map(str::to_string)).collect();
    Ok(state.scanner.trash_many(paths).await)
}

#[tauri::command(rename = "openFolder")]
pub async fn open_folder(state: State<'_, AppState>, path: Option<serde_json::Value>) -> Result<FolderResult, String> {
    if is_demo() {
        let Some(path) = string_arg(path.as_ref()) else {
            return Ok(FolderResult::err("Demo mode does not move files."));
        };
        return Ok(demo::demo_listing(path));
    }
    let Some(path) = string_arg(path.as_ref()) else {
        return Ok(FolderResult::err("That path is not one Stow measured."));
    };
    Ok(state.scanner.open_folder(path).await)
}

#[tauri::command(rename = "goTo")]
pub async fn go_to(state: State<'_, AppState>, path: Option<serde_json::Value>) -> Result<FolderResult, String> {
    if is_demo() {
        let Some(path) = string_arg(path.as_ref()) else {
            return Ok(FolderResult::err("Demo mode does not move files."));
        };
        return Ok(demo::demo_listing(&demo::expand_demo_home(path)));
    }
    let Some(path) = string_arg(path.as_ref()) else {
        return Ok(FolderResult::err("Type a folder path, like ~/Projects."));
    };
    Ok(state.scanner.go_to(path).await)
}

#[tauri::command(rename = "pickFolder")]
pub async fn pick_folder() -> Option<String> {
    off_main(run_folder_panel).await.ok().flatten()
}

fn run_folder_panel() -> Option<String> {
    let output = std::process::Command::new("osascript")
        .args([
            "-l",
            "JavaScript",
            "-e",
            r#"ObjC.import("AppKit"); var panel = $.NSOpenPanel.openPanel; panel.setCanChooseDirectories(true); panel.setCanChooseFiles(false); panel.setAllowsMultipleSelection(false); panel.setShowsHiddenFiles(true); panel.setPrompt("Go"); panel.setMessage("Go to folder"); if (panel.runModal == $.NSModalResponseOK) { ObjC.unwrap(panel.URL.path) } else { "" }"#,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() { None } else { Some(path) }
}

#[tauri::command(rename = "info")]
pub async fn info(state: State<'_, AppState>, path: Option<serde_json::Value>) -> Result<Option<crate::model::ItemInfo>, String> {
    let Some(path) = string_arg(path.as_ref()) else { return Ok(None) };
    if is_demo() {
        return Ok(Some(demo::demo_info(path)));
    }
    let _busy = state.activity.begin("info", Some(crate::paths::basename(path)));
    let path = path.to_string();
    Ok(off_main(move || item_info(&path)).await.ok().flatten())
}

#[tauri::command(rename = "setTheme")]
pub fn set_theme(window: tauri::WebviewWindow, choice: Option<serde_json::Value>) {
    let Some(choice) = string_arg(choice.as_ref()) else { return };
    if choice != "system" && choice != "light" && choice != "dark" {
        return;
    }
    apply_theme(&window, choice);
}

#[tauri::command(rename = "checkUpdate")]
pub async fn check_update(state: State<'_, AppState>) -> Result<Option<crate::model::UpdateInfo>, String> {
    if is_demo() {
        return Ok(None);
    }
    let repo = state.updates.lock().unwrap_or_else(|poison| poison.into_inner()).repo();
    let Some(repo) = repo else { return Ok(None) };
    let _busy = state.activity.begin("update", None);
    let info = crate::updates::Updates::fetch(&repo).await;
    state.updates.lock().unwrap_or_else(|poison| poison.into_inner()).set_latest(info.clone());
    Ok(info)
}

#[tauri::command(rename = "downloadUpdate")]
pub async fn download_update(app: AppHandle, state: State<'_, AppState>) -> Result<UpdateResult, String> {
    if is_demo() {
        return Ok(UpdateResult::from(Err("There is no update to download.".into())));
    }
    let (repo, latest) = {
        let updates = state.updates.lock().unwrap_or_else(|poison| poison.into_inner());
        (updates.repo(), updates.latest())
    };
    let _busy = state.activity.begin("download", latest.as_ref().map(|info| info.version.clone()));
    let staged = crate::updates::Updates::download(repo, latest, &app).await;
    Ok(UpdateResult::from(staged.map(|staged| state.updates.lock().unwrap_or_else(|poison| poison.into_inner()).set_staged(staged))))
}

// Takes no arguments: the only app it installs is the one `downloadUpdate` checked and staged.
#[tauri::command(rename = "installUpdate")]
pub async fn install_update(app: AppHandle, state: State<'_, AppState>) -> Result<UpdateResult, String> {
    let staged = state.updates.lock().unwrap_or_else(|poison| poison.into_inner()).staged();
    let Some(staged) = staged else {
        return Ok(UpdateResult::from(Err("Download the update first.".into())));
    };
    let result = off_main(move || crate::updates::install(&staged)).await?;
    if result.is_ok() {
        app.exit(0);
    }
    Ok(UpdateResult::from(result))
}

#[tauri::command(rename = "openReleasePage")]
pub async fn open_release_page(state: State<'_, AppState>) -> Result<(), String> {
    let updates = state.updates.clone();
    off_main(move || updates.lock().unwrap_or_else(|poison| poison.into_inner()).open_page()).await
}

#[tauri::command(rename = "fileIcons")]
pub async fn file_icons(state: State<'_, AppState>, paths: Option<serde_json::Value>) -> Result<std::collections::HashMap<String, crate::model::FileIconSet>, String> {
    let Some(list) = paths.as_ref().and_then(|value| value.as_array()) else {
        return Ok(std::collections::HashMap::new());
    };
    let paths: Vec<String> = list.iter().filter_map(|entry| entry.as_str().map(str::to_string)).collect();
    if is_demo() {
        return Ok(demo::demo_icons(&state.icons, &paths));
    }
    let _busy = state.activity.begin("icons", None);
    let icons = state.icons.clone();
    Ok(off_main(move || icons.file_icons(paths)).await.unwrap_or_default())
}

#[tauri::command(rename = "ask")]
pub async fn ask(target: Option<serde_json::Value>, prompt: Option<serde_json::Value>) -> AssistantResult {
    let Some(target) = string_arg(target.as_ref()).map(str::to_string) else {
        return AssistantResult::err("That assistant is not available.");
    };
    if !matches!(target.as_str(), "copy" | "chatgpt" | "claude" | "cursor" | "codex") {
        return AssistantResult::err("That assistant is not available.");
    }
    let Some(prompt) = string_arg(prompt.as_ref()).map(str::to_string) else {
        return AssistantResult::err("That prompt is empty.");
    };
    off_main(move || open_assistant(&target, &prompt)).await.unwrap_or_else(|_| AssistantResult::err("That assistant is not available."))
}

#[tauri::command(rename = "activity")]
pub fn activity(state: State<'_, AppState>) -> Vec<ActivityTask> {
    state.activity.list()
}
