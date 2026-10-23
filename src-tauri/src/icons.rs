use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;
use std::time::Duration;

use crate::model::FileIconSet;

const SCRIPT: &str = include_str!("../scripts/file-icons.js");

struct Helper {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

pub struct Icons {
    inner: Mutex<IconState>,
}

struct IconState {
    memory: HashMap<String, FileIconSet>,
    helper: Option<Helper>,
    script: std::path::PathBuf,
}

impl Icons {
    pub fn new() -> Self {
        Self { inner: Mutex::new(IconState { memory: HashMap::new(), helper: None, script: std::env::temp_dir().join("stow-file-icons.js") }) }
    }

    pub fn warm(&self) {
        if let Ok(mut state) = self.inner.lock() {
            let _ = ensure_helper(&mut state);
        }
    }

    pub fn stop(&self) {
        if let Ok(mut state) = self.inner.lock() {
            if let Some(mut helper) = state.helper.take() {
                let _ = helper.child.kill();
                crate::exec::kill_pid(helper.child.id(), false);
            }
        }
    }

    pub fn file_icons(&self, paths: Vec<String>) -> HashMap<String, FileIconSet> {
        let unique: Vec<String> = {
            let mut seen = Vec::new();
            for path in paths {
                if path.is_empty() || path.len() > 4096 || path.contains('\0') || seen.contains(&path) {
                    continue;
                }
                seen.push(path);
                if seen.len() == 80 {
                    break;
                }
            }
            seen
        };
        if unique.is_empty() {
            return HashMap::new();
        }
        let Ok(mut state) = self.inner.lock() else { return HashMap::new() };
        let mut ready = HashMap::new();
        let missing: Vec<String> = unique
            .into_iter()
            .filter(|path| match state.memory.get(path) {
                Some(icon) => {
                    ready.insert(path.clone(), icon.clone());
                    false
                }
                None => true,
            })
            .collect();
        if missing.is_empty() {
            return ready;
        }
        let icons = query(&mut state, &missing);
        for (path, icon) in &icons {
            if icon.light.starts_with("data:image/png") || icon.dark.starts_with("data:image/png") {
                state.memory.insert(path.clone(), icon.clone());
            }
        }
        ready.extend(icons);
        ready
    }
}

fn query(state: &mut IconState, paths: &[String]) -> HashMap<String, FileIconSet> {
    for _attempt in 0..2 {
        let Some(helper) = ensure_helper(state) else { return HashMap::new() };
        let line = match serde_json::to_string(paths) {
            Ok(line) => line,
            Err(_) => return HashMap::new(),
        };
        if writeln!(helper.stdin, "{line}").is_err() {
            stop_helper(state);
            continue;
        }
        match helper.lines.recv_timeout(Duration::from_secs(45)) {
            Ok(line) if !line.trim().is_empty() => return parse_icons(paths, &line),
            _ => {
                stop_helper(state);
            }
        }
    }
    HashMap::new()
}

fn parse_icons(paths: &[String], line: &str) -> HashMap<String, FileIconSet> {
    let mut icons = HashMap::new();
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) else { return icons };
    for path in paths {
        let Some(pair) = parsed.get(path) else { continue };
        icons.insert(
            path.clone(),
            FileIconSet {
                light: png_icon(pair.get("light").and_then(|value| value.as_str()).unwrap_or("")),
                dark: png_icon(pair.get("dark").and_then(|value| value.as_str()).unwrap_or("")),
            },
        );
    }
    icons
}

fn png_icon(raw: &str) -> String {
    if raw.starts_with("iVBORw0KGgo") {
        format!("data:image/png;base64,{raw}")
    } else {
        String::new()
    }
}

fn ensure_helper(state: &mut IconState) -> Option<&mut Helper> {
    let alive = state.helper.as_mut().and_then(|helper| helper.child.try_wait().ok()).flatten().is_none() && state.helper.is_some();
    if alive {
        return state.helper.as_mut();
    }
    state.helper = None;
    if std::fs::write(&state.script, SCRIPT).is_err() {
        return None;
    }
    let mut child = Command::new("osascript")
        .args(["-l", "JavaScript", &state.script.to_string_lossy()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    let (sender, lines) = mpsc::channel();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    state.helper = Some(Helper { child, stdin, lines });
    state.helper.as_mut()
}

fn stop_helper(state: &mut IconState) {
    if let Some(helper) = state.helper.take() {
        crate::exec::kill_pid(helper.child.id(), false);
    }
}
