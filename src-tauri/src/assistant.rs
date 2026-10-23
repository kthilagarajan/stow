use std::io::Write;
use std::process::{Command, Stdio};

use crate::model::AssistantResult;
use crate::paths;

const URL_LIMIT: usize = 6000;

pub fn open_assistant(target: &str, prompt: &str) -> AssistantResult {
    if prompt.is_empty() || prompt.len() > 20_000 {
        return AssistantResult::err("That prompt is empty.");
    }
    if !copy_to_clipboard(prompt) {
        return AssistantResult::err("That prompt is empty.");
    }
    if target == "copy" {
        return AssistantResult::ok("Copied. Paste it into a chat.");
    }
    let name = match target {
        "chatgpt" => "ChatGPT",
        "claude" => "Claude",
        "cursor" => "Cursor",
        "codex" => "Codex",
        _ => return AssistantResult::err("That assistant is not available."),
    };
    if target == "chatgpt" {
        return open_chatgpt(name);
    }
    let clipped = if prompt.len() > URL_LIMIT { None } else { Some(prompt) };
    let opened = match target {
        "claude" => open_named(name, &["Claude"], clipped.map(|text| format!("claude://claude.ai/new?q={}&surface=chat&source=desktop_action", encode(text)))),
        "cursor" => open_named(name, &["Cursor"], clipped.map(|text| format!("cursor://anysphere.cursor-deeplink/prompt?text={}", encode(text)))),
        "codex" => open_codex(name, clipped),
        _ => AssistantResult::err("That assistant is not available."),
    };
    if !opened.ok {
        return opened;
    }
    if clipped.is_none() {
        AssistantResult::ok(format!("Opened {name}. The full prompt is on the clipboard. Paste it into the chat."))
    } else if target == "chatgpt" {
        opened
    } else {
        AssistantResult::ok(format!("Opened {name}. The prompt is in the new chat, and also on the clipboard."))
    }
}

fn open_chatgpt(name: &str) -> AssistantResult {
    if chat_gpt_app().is_none() {
        return AssistantResult::err(format!("{name} is not installed. The prompt is on the clipboard."));
    }
    if open_url("chatgpt://new-conversation").is_err() {
        return AssistantResult::err(format!("Could not open {name}. The prompt is on the clipboard."));
    }
    AssistantResult::ok(format!("Opened {name}. Paste the prompt into the new chat. It is on the clipboard."))
}

fn open_codex(name: &str, clipped: Option<&str>) -> AssistantResult {
    let Some(app) = codex_app() else {
        return AssistantResult::err(format!("{name} is not installed. The prompt is on the clipboard."));
    };
    let result = if let Some(text) = clipped {
        open_url(&format!("codex://threads/new?prompt={}", encode(text)))
    } else {
        open_app(&app)
    };
    if result.is_err() {
        return AssistantResult::err(format!("Could not open {name}. The prompt is on the clipboard."));
    }
    AssistantResult::ok("")
}

fn open_named(name: &str, apps: &[&str], url: Option<String>) -> AssistantResult {
    let Some(app) = find_app(apps) else {
        return AssistantResult::err(format!("{name} is not installed. The prompt is on the clipboard."));
    };
    let result = if let Some(url) = url { open_url(&url) } else { open_app(&app) };
    if result.is_err() {
        return AssistantResult::err(format!("Could not open {name}. The prompt is on the clipboard."));
    }
    AssistantResult::ok("")
}

fn chat_gpt_app() -> Option<String> {
    find_app(&["ChatGPT Classic"]).or_else(|| app_with_bundle_id(&["ChatGPT"], "com.openai.chat"))
}

fn codex_app() -> Option<String> {
    find_app(&["Codex"]).or_else(|| app_with_bundle_id(&["ChatGPT", "Codex"], "com.openai.codex"))
}

fn find_app(names: &[&str]) -> Option<String> {
    let home = paths::home_dir();
    let roots = ["/Applications".to_string(), paths::join(&[&home, "Applications"])];
    for root in roots {
        for name in names {
            let full = paths::join(&[&root, &format!("{name}.app")]);
            if std::path::Path::new(&full).exists() {
                return Some(full);
            }
        }
    }
    None
}

fn app_with_bundle_id(names: &[&str], bundle_id: &str) -> Option<String> {
    for name in names {
        let Some(full) = find_app(&[name]) else { continue };
        if read_bundle_id(&full).as_deref() == Some(bundle_id) {
            return Some(full);
        }
    }
    None
}

fn read_bundle_id(app_path: &str) -> Option<String> {
    let info = paths::join(&[app_path, "Contents/Info"]);
    let output = Command::new("defaults").args(["read", &info, "CFBundleIdentifier"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() { None } else { Some(text) }
}

fn open_url(url: &str) -> Result<(), ()> {
    Command::new("open").arg(url).spawn().map(|_| ()).map_err(|_| ())
}

fn open_app(app_path: &str) -> Result<(), ()> {
    Command::new("open").args(["-a", app_path]).status().map_err(|_| ()).and_then(|status| if status.success() { Ok(()) } else { Err(()) })
}

fn copy_to_clipboard(text: &str) -> bool {
    let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() else {
        return false;
    };
    let Some(mut stdin) = child.stdin.take() else { return false };
    if stdin.write_all(text.as_bytes()).is_err() {
        return false;
    }
    drop(stdin);
    child.wait().map(|status| status.success()).unwrap_or(false)
}

fn encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.as_bytes() {
        let ch = *byte;
        if ch.is_ascii_alphanumeric() || matches!(ch, b'-' | b'_' | b'.' | b'~') {
            out.push(ch as char);
        } else {
            out.push_str(&format!("%{ch:02X}"));
        }
    }
    out
}
