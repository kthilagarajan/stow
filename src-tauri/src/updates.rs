use std::io::Write;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::model::{app_version, UpdateAsset, UpdateInfo, UpdateProgress};
use crate::version::is_newer;

// GitHub's servers answer on several addresses, and one can be unreachable from some networks.
// The connect timeout is shared across the addresses, so a dead one is skipped in seconds instead of
// after macOS's 75-second wait. The read timeout ends a stalled download instead of leaving it hanging.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const READ_TIMEOUT: Duration = Duration::from_secs(30);

const STOPPED: &str = "The download stopped. Check the connection and try again.";

pub struct Updates {
    latest: Option<UpdateInfo>,
    repo: Option<String>,
    // The new Stow.app, unpacked and checked, waiting for a restart to take its place.
    staged: Option<PathBuf>,
}

impl Updates {
    pub fn new() -> Self {
        Self { latest: None, repo: repository(), staged: None }
    }

    pub fn repo(&self) -> Option<String> {
        self.repo.clone()
    }

    pub fn set_latest(&mut self, info: Option<UpdateInfo>) {
        self.latest = info;
    }

    pub fn latest(&self) -> Option<UpdateInfo> {
        self.latest.clone()
    }

    pub fn set_staged(&mut self, app: PathBuf) {
        self.staged = Some(app);
    }

    pub fn staged(&self) -> Option<PathBuf> {
        self.staged.clone()
    }

    pub async fn fetch(repo: &str) -> Option<UpdateInfo> {
        let version = app_version();
        let url = format!("https://api.github.com/repos/{repo}/releases/latest");
        let client = reqwest::Client::builder().connect_timeout(CONNECT_TIMEOUT).timeout(Duration::from_secs(20)).build().ok()?;
        let response = client
            .get(url)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", format!("Stow/{version}"))
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let release: serde_json::Value = response.json().await.ok()?;
        if release.get("draft").and_then(|value| value.as_bool()).unwrap_or(false)
            || release.get("prerelease").and_then(|value| value.as_bool()).unwrap_or(false)
        {
            return None;
        }
        let tag = release.get("tag_name").and_then(|value| value.as_str()).unwrap_or("");
        if !is_newer(tag, &version) {
            return None;
        }
        let assets = release.get("assets").and_then(|value| value.as_array());
        let asset = assets.and_then(|assets| pick_asset(assets));
        let info = UpdateInfo {
            version: tag.trim_start_matches('v').to_string(),
            notes: plain_notes(release.get("body").and_then(|value| value.as_str()).unwrap_or("")),
            page_url: release.get("html_url").and_then(|value| value.as_str()).unwrap_or("").to_string(),
            asset,
        };
        Some(info)
    }

    /// Downloads the release's zipped app for this chip, checks it, and unpacks it next to the download.
    /// Returns the new Stow.app, ready for `install` to put in place of this one.
    pub async fn download(repo: Option<String>, latest: Option<UpdateInfo>, app: &AppHandle) -> Result<PathBuf, String> {
        let nothing = || "There is no update to download.".to_string();
        let repo = repo.ok_or_else(nothing)?;
        let latest = latest.ok_or_else(nothing)?;
        let asset = latest.asset.clone().ok_or_else(nothing)?;
        let prefix = format!("https://github.com/{repo}/releases/download/");
        if !asset.url.starts_with(&prefix) {
            return Err("That download is not from Stow’s releases.".into());
        }
        // Fail before downloading when this copy could not be replaced anyway.
        bundle_path()?;
        let work = std::env::temp_dir().join(format!("stow-update-{}", latest.version));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).map_err(|_| STOPPED.to_string())?;
        let zip = work.join("update.zip");
        let version = app_version();
        download_file(&asset, &zip, &version, app).await?;
        let identifier = app.config().identifier.clone();
        let expected = latest.version.clone();
        tauri::async_runtime::spawn_blocking(move || unpack(&zip, &work, &identifier, &expected))
            .await
            .map_err(|_| "The update could not be unpacked.".to_string())?
    }

    pub fn open_page(&self) {
        let Some(repo) = &self.repo else { return };
        let Some(latest) = &self.latest else { return };
        let prefix = format!("https://github.com/{repo}/releases/");
        if latest.page_url.starts_with(&prefix) {
            let _ = std::process::Command::new("open").arg(&latest.page_url).spawn();
        }
    }
}

/// Hands the staged app to a small script that waits for Stow to quit, swaps the bundles, and opens the new one.
/// The caller quits the app straight after.
pub fn install(staged: &Path) -> Result<(), String> {
    let bundle = bundle_path()?;
    if !staged.join("Contents/Info.plist").is_file() {
        return Err("The downloaded update is gone. Download it again.".into());
    }
    let script = staged.parent().unwrap_or(staged).join("swap.sh");
    std::fs::write(&script, swap_script(std::process::id(), &bundle, staged)).map_err(|_| "Stow could not start the update.".to_string())?;
    Command::new("/bin/sh")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| "Stow could not start the update.".to_string())?;
    Ok(())
}

/// The Stow.app this process runs from, provided it can be replaced in place.
fn bundle_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| "Stow could not find its own app.".to_string())?;
    // .../Stow.app/Contents/MacOS/stow
    let bundle = exe.ancestors().nth(3).map(Path::to_path_buf).unwrap_or_default();
    if bundle.extension().and_then(|ext| ext.to_str()) != Some("app") {
        return Err("Updates install into the Stow app. This copy is not running from one.".into());
    }
    let text = bundle.to_string_lossy();
    if text.starts_with("/Volumes/") || text.contains("/AppTranslocation/") {
        return Err("Move Stow to the Applications folder first, then update.".into());
    }
    let parent = bundle.parent().ok_or_else(|| "Stow could not find its own app.".to_string())?;
    let writable = std::ffi::CString::new(parent.as_os_str().as_encoded_bytes())
        .map(|path| unsafe { libc::access(path.as_ptr(), libc::W_OK) } == 0)
        .unwrap_or(false);
    if !writable {
        return Err(format!("Stow does not have permission to replace itself in {}.", parent.display()));
    }
    Ok(bundle)
}

fn unpack(zip: &Path, work: &Path, identifier: &str, version: &str) -> Result<PathBuf, String> {
    let fail = || "The update could not be unpacked.".to_string();
    let out = work.join("app");
    let status = Command::new("/usr/bin/ditto").arg("-x").arg("-k").arg(zip).arg(&out).stdin(Stdio::null()).status().map_err(|_| fail())?;
    let _ = std::fs::remove_file(zip);
    if !status.success() {
        return Err(fail());
    }
    let apps: Vec<PathBuf> = std::fs::read_dir(&out)
        .map_err(|_| fail())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("app"))
        .collect();
    let [staged] = apps.as_slice() else { return Err(fail()) };
    let plist = staged.join("Contents/Info.plist");
    if plist_value(&plist, "CFBundleIdentifier").as_deref() != Some(identifier) {
        return Err("The download is not Stow.".into());
    }
    if plist_value(&plist, "CFBundleShortVersionString").as_deref() != Some(version) {
        return Err("The download does not match the release.".into());
    }
    Ok(staged.clone())
}

fn plist_value(plist: &Path, key: &str) -> Option<String> {
    let output = Command::new("/usr/bin/plutil").args(["-extract", key, "raw", "-o", "-"]).arg(plist).stdin(Stdio::null()).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Waits (up to 30s) for Stow to quit, moves the new app into place, and opens it. If the move fails the old app is put back.
fn swap_script(pid: u32, current: &Path, next: &Path) -> String {
    let quote = |path: &Path| format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"));
    format!(
        r#"#!/bin/sh
APP={app}
NEW={new}
OLD="$APP.previous"
i=0
while kill -0 {pid} 2>/dev/null && [ $i -lt 300 ]; do sleep 0.1; i=$((i + 1)); done
rm -rf "$OLD"
if mv "$APP" "$OLD" && mv "$NEW" "$APP"; then
  rm -rf "$OLD"
else
  [ -e "$APP" ] || mv "$OLD" "$APP"
fi
open "$APP"
"#,
        app = quote(current),
        new = quote(next),
    )
}

async fn download_file(asset: &UpdateAsset, file: &Path, version: &str, app: &AppHandle) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .build()
        .map_err(|_| STOPPED.to_string())?;
    let response = client
        .get(&asset.url)
        .header("User-Agent", format!("Stow/{version}"))
        .send()
        .await
        .map_err(|_| STOPPED.to_string())?;
    if !response.status().is_success() {
        return Err("GitHub did not send the update. Try again later.".into());
    }
    let total = response.content_length().unwrap_or(asset.bytes);
    let mut received: u64 = 0;
    let mut reported = std::time::Instant::now() - Duration::from_secs(1);
    let mut output = std::fs::File::create(file).map_err(|_| STOPPED.to_string())?;
    let mut hash = Sha256::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| STOPPED.to_string())?;
        hash.update(&chunk);
        output.write_all(&chunk).map_err(|_| STOPPED.to_string())?;
        received += chunk.len() as u64;
        if reported.elapsed() > Duration::from_millis(120) {
            reported = std::time::Instant::now();
            emit_progress(app, received, total);
        }
    }
    if asset.bytes > 0 && received != asset.bytes {
        return Err("The download was incomplete. Try again.".into());
    }
    if let Some(expected) = &asset.sha256 {
        let actual: String = hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
        if !actual.eq_ignore_ascii_case(expected) {
            return Err("The download was damaged on the way. Try again.".into());
        }
    }
    emit_progress(app, total, total);
    Ok(())
}

fn emit_progress(app: &AppHandle, received: u64, total: u64) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("update:progress", UpdateProgress { received, total });
    }
}

fn repository() -> Option<String> {
    if let Ok(value) = std::env::var("STOW_UPDATE_REPO") {
        if !value.is_empty() {
            return Some(value);
        }
    }
    let pkg: serde_json::Value = serde_json::from_str(include_str!("../../package.json")).ok()?;
    let url = match pkg.get("repository")? {
        serde_json::Value::String(url) => url.clone(),
        other => other.get("url").and_then(|value| value.as_str()).unwrap_or("").to_string(),
    };
    github_repo(&url)
}

fn github_repo(url: &str) -> Option<String> {
    let rest = url.split("github.com").nth(1)?;
    let rest = rest.trim_start_matches(['/', ':']);
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut parts = rest.split('/');
    let owner = parts.next()?.trim();
    let name = parts.next()?.trim();
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    let ok = |value: &str| value.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.' | '_'));
    if ok(owner) && ok(name) { Some(format!("{owner}/{name}")) } else { None }
}

fn chip_token() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    }
}

fn pick_asset(assets: &[serde_json::Value]) -> Option<UpdateAsset> {
    let images: Vec<&serde_json::Value> = assets
        .iter()
        .filter(|asset| asset.get("name").and_then(|value| value.as_str()).unwrap_or("").to_lowercase().ends_with(".app.zip"))
        .collect();
    let chip = chip_token();
    let chosen = images
        .iter()
        .copied()
        .find(|asset| {
            let name = asset.get("name").and_then(|value| value.as_str()).unwrap_or("");
            name.contains(chip) || (chip == "arm64" && name.contains("aarch64")) || (chip == "x64" && name.contains("x86_64"))
        })
        .or_else(|| {
            images.iter().copied().find(|asset| {
                let name = asset.get("name").and_then(|value| value.as_str()).unwrap_or("");
                !name.contains("arm64") && !name.contains("x64") && !name.contains("universal") && !name.contains("aarch64") && !name.contains("x86_64")
            })
        })?;
    Some(UpdateAsset {
        name: chosen.get("name")?.as_str()?.to_string(),
        url: chosen.get("browser_download_url")?.as_str()?.to_string(),
        bytes: chosen.get("size").and_then(|value| value.as_u64()).unwrap_or(0),
        // GitHub publishes `sha256:<hex>` for release assets.
        sha256: chosen.get("digest").and_then(|value| value.as_str()).and_then(|digest| digest.strip_prefix("sha256:")).map(str::to_string),
    })
}

fn plain_notes(body: &str) -> String {
    let mut text = body.replace('\r', "");
    text = strip_prefix_lines(&text, |line| {
        let hashes = line.chars().take_while(|ch| *ch == '#').count();
        if (1..=6).contains(&hashes) && line.chars().nth(hashes) == Some(' ') {
            line[hashes + 1..].to_string()
        } else {
            line.to_string()
        }
    });
    text = strip_bold(&text);
    text = strip_prefix_lines(&text, |line| {
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            format!("{}• {}", " ".repeat(indent), &trimmed[2..])
        } else {
            line.to_string()
        }
    });
    text = strip_links(&text);
    let trimmed = text.trim();
    trimmed.chars().take(4000).collect()
}

fn strip_prefix_lines(text: &str, map: impl Fn(&str) -> String) -> String {
    text.lines().map(map).collect::<Vec<_>>().join("\n")
}

fn strip_bold(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("**") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        if let Some(end) = after.find("**") {
            out.push_str(&after[..end]);
            rest = &after[end + 2..];
        } else {
            out.push_str("**");
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

fn strip_links(text: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = text.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '[' {
            if let Some(label_end) = chars[index + 1..].iter().position(|ch| *ch == ']') {
                let label_end = index + 1 + label_end;
                if chars.get(label_end + 1) == Some(&'(') {
                    if let Some(url_end) = chars[label_end + 2..].iter().position(|ch| *ch == ')') {
                        out.extend(chars[index + 1..label_end].iter());
                        index = label_end + 2 + url_end + 1;
                        continue;
                    }
                }
            }
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_this_repository() {
        assert_eq!(github_repo("https://github.com/kthilagarajan/stow.git").as_deref(), Some("kthilagarajan/stow"));
    }

    #[test]
    fn picks_the_zipped_app_for_this_chip() {
        let assets: Vec<serde_json::Value> = serde_json::from_str(
            r#"[
                {"name": "Stow_2.0.0_aarch64.dmg", "browser_download_url": "https://x/a.dmg", "size": 9},
                {"name": "Stow_2.0.0_aarch64.app.zip", "browser_download_url": "https://x/a.zip", "size": 7, "digest": "sha256:ab12"},
                {"name": "Stow_2.0.0_x86_64.app.zip", "browser_download_url": "https://x/b.zip", "size": 8}
            ]"#,
        )
        .unwrap();
        let asset = pick_asset(&assets).unwrap();
        let chip = if std::env::consts::ARCH == "aarch64" { "aarch64" } else { "x86_64" };
        assert!(asset.name.contains(chip) && asset.name.ends_with(".app.zip"));
        if chip == "aarch64" {
            assert_eq!(asset.sha256.as_deref(), Some("ab12"));
        }
    }

    #[test]
    fn swap_script_quotes_paths() {
        let script = swap_script(42, Path::new("/Applications/Stow.app"), Path::new("/tmp/it's/Stow.app"));
        assert!(script.contains("APP='/Applications/Stow.app'"));
        assert!(script.contains(r"NEW='/tmp/it'\''s/Stow.app'"));
        assert!(script.contains("kill -0 42"));
    }

    #[test]
    fn notes_become_plain_text() {
        let notes = plain_notes("## Stow\n\n**Hello** [site](https://example.com)\n- one");
        assert!(notes.contains("Stow"));
        assert!(notes.contains("Hello"));
        assert!(notes.contains("site"));
        assert!(!notes.contains("https://example.com"));
        assert!(notes.contains("• one"));
    }
}
