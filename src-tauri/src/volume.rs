use std::process::{Command, Stdio};

use crate::model::VolumeInfo;

fn run(program: &str, args: &[&str], input: Option<&[u8]>) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    if let Some(bytes) = input {
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(bytes);
        }
    }
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn diskutil(mount: &str) -> Result<serde_json::Value, String> {
    let xml = run("diskutil", &["info", "-plist", mount], None)?;
    let json = run("plutil", &["-convert", "json", "-o", "-", "-"], Some(xml.as_bytes()))?;
    serde_json::from_str(&json).map_err(|error| error.to_string())
}

fn number(value: &serde_json::Value, key: &str) -> u64 {
    value.get(key).and_then(|entry| entry.as_u64()).unwrap_or(0)
}

fn display_name(name: Option<&str>) -> String {
    let cleaned = name.unwrap_or("Macintosh HD").replace(" - Data", "").trim().to_string();
    if cleaned.is_empty() { "Macintosh HD".to_string() } else { cleaned }
}

fn from_df() -> Result<VolumeInfo, String> {
    let text = run("df", &["-k", "/System/Volumes/Data"], None)?;
    let line = text.trim().lines().last().unwrap_or("");
    let parts: Vec<&str> = line.split_whitespace().collect();
    let total = parts.get(1).and_then(|value| value.parse::<u64>().ok()).unwrap_or(0).saturating_mul(1024);
    let used = parts.get(2).and_then(|value| value.parse::<u64>().ok()).unwrap_or(0).saturating_mul(1024);
    let free = parts.get(3).and_then(|value| value.parse::<u64>().ok()).unwrap_or(0).saturating_mul(1024);
    Ok(VolumeInfo { name: "Macintosh HD".to_string(), total_bytes: total, used_bytes: used, free_bytes: free })
}

pub fn read_volume() -> Result<VolumeInfo, String> {
    if !cfg!(target_os = "macos") {
        return Err("Stow reads disks on macOS.".to_string());
    }
    let (boot, data) = std::thread::scope(|scope| {
        let data = scope.spawn(|| diskutil("/System/Volumes/Data"));
        let boot = diskutil("/");
        (boot, data.join().unwrap_or_else(|_| Err("diskutil stopped.".to_string())))
    });
    match (boot, data) {
        (Ok(boot), Ok(data)) => {
            let total = number(&data, "APFSContainerSize").max(number(&boot, "APFSContainerSize"));
            let free = number(&data, "APFSContainerFree").max(number(&boot, "APFSContainerFree"));
            if total == 0 {
                return from_df();
            }
            let name = boot.get("VolumeName").and_then(|value| value.as_str()).or_else(|| data.get("VolumeName").and_then(|value| value.as_str()));
            Ok(VolumeInfo {
                name: display_name(name),
                total_bytes: total,
                free_bytes: free,
                used_bytes: total.saturating_sub(free),
            })
        }
        _ => from_df(),
    }
}
