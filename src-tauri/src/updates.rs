use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager};

use crate::model::{app_version, UpdateAsset, UpdateDownload, UpdateInfo, UpdateProgress};
use crate::paths;
use crate::version::is_newer;

// GitHub's servers answer on several addresses, and one can be unreachable from some networks.
// The connect timeout is shared across the addresses, so a dead one is skipped in seconds instead of
// after macOS's 75-second wait. The read timeout ends a stalled download instead of leaving it hanging.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const READ_TIMEOUT: Duration = Duration::from_secs(30);

pub struct Updates {
    latest: Option<UpdateInfo>,
    repo: Option<String>,
}

impl Updates {
    pub fn new() -> Self {
        Self { latest: None, repo: repository() }
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

    pub async fn download(repo: Option<String>, latest: Option<UpdateInfo>, app: &AppHandle) -> UpdateDownload {
        let Some(repo) = repo else {
            return UpdateDownload::err("There is no update to download.");
        };
        let Some(latest) = latest else {
            return UpdateDownload::err("There is no update to download.");
        };
        let Some(asset) = latest.asset.clone() else {
            return UpdateDownload::err("There is no update to download.");
        };
        let prefix = format!("https://github.com/{repo}/releases/download/");
        if !asset.url.starts_with(&prefix) {
            return UpdateDownload::err("That download is not from Stow’s releases.");
        }
        let Some(downloads) = downloads_dir(app) else {
            return UpdateDownload::err("The download stopped. Check the connection and try again.");
        };
        let file = downloads.join(paths::basename(&asset.name));
        let partial = PathBuf::from(format!("{}.download", file.display()));
        let version = app_version();
        let result = download_file(&asset, &partial, &file, &version, app).await;
        if result.is_err() {
            let _ = std::fs::remove_file(&partial);
        }
        result.unwrap_or_else(|error| error)
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

fn downloads_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().download_dir().ok()
}

pub fn open_downloaded(app: &AppHandle, file: &str) {
    let Some(downloads) = downloads_dir(app) else { return };
    let path = PathBuf::from(file);
    if path.parent() != Some(downloads.as_path()) || !file.ends_with(".dmg") || !path.is_file() {
        return;
    }
    let _ = std::process::Command::new("open").arg(&path).spawn();
}

async fn download_file(
    asset: &UpdateAsset,
    partial: &std::path::Path,
    file: &std::path::Path,
    version: &str,
    app: &AppHandle,
) -> Result<UpdateDownload, UpdateDownload> {
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .build()
        .map_err(|_| UpdateDownload::err("The download stopped. Check the connection and try again."))?;
    let response = client
        .get(&asset.url)
        .header("User-Agent", format!("Stow/{version}"))
        .send()
        .await
        .map_err(|_| UpdateDownload::err("The download stopped. Check the connection and try again."))?;
    if !response.status().is_success() {
        return Err(UpdateDownload::err("GitHub did not send the update. Try again later."));
    }
    let total = response.content_length().unwrap_or(asset.bytes);
    let mut received: u64 = 0;
    let mut reported = std::time::Instant::now() - Duration::from_secs(1);
    let mut output = std::fs::File::create(partial).map_err(|_| UpdateDownload::err("The download stopped. Check the connection and try again."))?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| UpdateDownload::err("The download stopped. Check the connection and try again."))?;
        output.write_all(&chunk).map_err(|_| UpdateDownload::err("The download stopped. Check the connection and try again."))?;
        received += chunk.len() as u64;
        if reported.elapsed() > Duration::from_millis(120) {
            reported = std::time::Instant::now();
            emit_progress(app, received, total);
        }
    }
    if asset.bytes > 0 && received != asset.bytes {
        let _ = std::fs::remove_file(partial);
        return Err(UpdateDownload::err("The download was incomplete. Try again."));
    }
    std::fs::rename(partial, file).map_err(|_| UpdateDownload::err("The download stopped. Check the connection and try again."))?;
    emit_progress(app, total, total);
    Ok(UpdateDownload::ok(file.display().to_string()))
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
        .filter(|asset| asset.get("name").and_then(|value| value.as_str()).unwrap_or("").to_lowercase().ends_with(".dmg"))
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
    fn notes_become_plain_text() {
        let notes = plain_notes("## Stow\n\n**Hello** [site](https://example.com)\n- one");
        assert!(notes.contains("Stow"));
        assert!(notes.contains("Hello"));
        assert!(notes.contains("site"));
        assert!(!notes.contains("https://example.com"));
        assert!(notes.contains("• one"));
    }
}
