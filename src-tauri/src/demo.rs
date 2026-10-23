use std::collections::HashMap;

use crate::catalog::static_roots;
use crate::model::{EntryKind, FileIconSet, FolderEntry, FolderResult, ItemInfo, SavedScan, StorageChild, StorageItem, Verdict, VolumeInfo};
use crate::paths;

pub fn is_demo() -> bool {
    std::env::var("STOW_DEMO").ok().as_deref() == Some("1")
}

const HOME: &str = "/Users/alex";
const GB: f64 = 1_000_000_000.0;
const MB: f64 = 1_000_000.0;
const DAY: i64 = 86_400_000;

fn bytes(value: f64) -> u64 {
    value.round().max(0.0) as u64
}

pub fn demo_scan() -> SavedScan {
    SavedScan { scanned_at: crate::model::now_ms() - 42 * 60_000, limited: 3, items: items() }
}

pub fn demo_volume() -> VolumeInfo {
    VolumeInfo { name: "Macintosh HD".to_string(), total_bytes: bytes(494.4 * GB), used_bytes: bytes(380.0 * GB), free_bytes: bytes(114.4 * GB) }
}

fn sizes() -> HashMap<&'static str, u64> {
    HashMap::from([
        ("keychains", bytes(0.02 * GB)),
        ("preferences", bytes(0.03 * GB)),
        ("documents", bytes(18.5 * GB)),
        ("desktop", bytes(2.2 * GB)),
        ("pictures", bytes(34.6 * GB)),
        ("movies", bytes(41.2 * GB)),
        ("music", bytes(8.1 * GB)),
        ("mail", bytes(3.4 * GB)),
        ("messages", bytes(6.7 * GB)),
        ("icloud", bytes(12.4 * GB)),
        ("app-support", bytes(22.8 * GB)),
        ("applications", bytes(31.5 * GB)),
        ("user-apps", bytes(2.3 * GB)),
        ("caches", bytes(13.4 * GB)),
        ("logs", bytes(180.0 * MB)),
        ("trash", bytes(2.6 * GB)),
        ("npm", bytes(6.2 * GB)),
        ("downloads", bytes(9.8 * GB)),
        ("simulators", bytes(8.4 * GB)),
        ("docker", bytes(21.6 * GB)),
        ("pnpm", bytes(11.3 * GB)),
        ("cargo", bytes(2.1 * GB)),
        ("go", bytes(1.3 * GB)),
        ("android", bytes(5.0 * GB)),
        ("homebrew", bytes(4.2 * GB)),
    ])
}

fn children_for(id: &str) -> Vec<(&'static str, u64)> {
    match id {
        "caches" => vec![
            ("Google", bytes(3.1 * GB)),
            ("com.spotify.client", bytes(2.2 * GB)),
            ("pnpm", bytes(1.4 * GB)),
            ("CocoaPods", bytes(1.1 * GB)),
            ("com.apple.Safari", bytes(640.0 * MB)),
            ("Yarn", bytes(420.0 * MB)),
        ],
        "npm" => vec![("_cacache", bytes(5.1 * GB)), ("_npx", bytes(1.1 * GB))],
        "downloads" => vec![("Figma-arm64.dmg", bytes(410.0 * MB)), ("design-assets", bytes(2.4 * GB)), ("invoices-2025", bytes(120.0 * MB))],
        _ => Vec::new(),
    }
}

fn looks_like_file(name: &str) -> bool {
    let Some(dot) = name.rfind('.') else { return false };
    if dot == 0 || name[..dot].contains('/') {
        return false;
    }
    let ext = &name[dot + 1..];
    (2..=4).contains(&ext.len()) && ext.chars().all(|ch| ch.is_ascii_alphanumeric())
}

fn child(parent: &StorageItem, name: &str, bytes: u64) -> StorageChild {
    let file = looks_like_file(name);
    StorageChild {
        name: name.to_string(),
        path: paths::join(&[&parent.path, name]),
        bytes,
        verdict: parent.verdict,
        summary: if file {
            "An installer you downloaded.".to_string()
        } else if parent.verdict == Verdict::Clear {
            "A cache. The app rebuilds it.".to_string()
        } else {
            "A folder inside this one.".to_string()
        },
        trashable: parent.trashable,
        kind: Some(if file { EntryKind::File } else { EntryKind::Folder }),
    }
}

fn items() -> Vec<StorageItem> {
    let known = sizes();
    let mut roots = Vec::new();
    for spec in static_roots(HOME) {
        let Some(bytes) = known.get(spec.id.as_str()).copied() else { continue };
        let mut item = StorageItem {
            id: spec.id.clone(),
            title: spec.title,
            path: spec.path,
            bytes,
            verdict: spec.verdict,
            group: spec.group,
            summary: spec.summary,
            detail: spec.detail,
            children: Vec::new(),
            trashable: spec.trashable,
            lift_from_parent: spec.lift_from_parent,
            shadow: false,
            complete: true,
            limited: false,
        };
        item.children = children_for(&item.id).into_iter().map(|(name, bytes)| child(&item, name, bytes)).collect();
        roots.push(item);
    }
    let large = [
        ("Movies/Holiday 2025.mov", bytes(6.4 * GB), Verdict::Keep, false, "A video of yours. Stow will not move it."),
        ("Downloads/ubuntu-24.04-desktop-arm64.iso", bytes(3.1 * GB), Verdict::Optional, true, "A disk image. If it is installed, this is usually safe to clear."),
        ("Documents/Archive/photos-backup.zip", bytes(2.0 * GB), Verdict::Keep, false, "An archive of your files. Stow will not move it."),
    ];
    for (relative, bytes, verdict, trashable, summary) in large {
        let file_path = paths::join(&[HOME, relative]);
        roots.push(StorageItem {
            id: format!("large:{file_path}"),
            title: paths::basename(&file_path),
            path: file_path,
            bytes,
            verdict,
            group: "Large files".to_string(),
            summary: summary.to_string(),
            detail: summary.to_string(),
            children: Vec::new(),
            trashable,
            lift_from_parent: false,
            shadow: true,
            complete: true,
            limited: false,
        });
    }
    roots
}

fn seed(value: &str) -> u32 {
    let mut hash: u32 = 0;
    for ch in value.chars() {
        hash = hash.wrapping_mul(31).wrapping_add(ch as u32);
    }
    hash
}

const INSIDE: &[&str] = &["Cache", "Code Cache", "GPUCache", "Service Worker", "blob_storage", "Crashpad"];

pub fn demo_listing(file_path: &str) -> FolderResult {
    let all = items();
    let Some(owner) = all.iter().find(|item| item.path == file_path || file_path.starts_with(&format!("{}/", item.path))) else {
        return FolderResult::err("There is no folder at that path.");
    };
    let known = all.iter().find(|item| item.path == file_path);
    let total = known
        .map(|item| item.bytes)
        .or_else(|| owner.children.iter().find(|entry| entry.path == file_path).map(|entry| entry.bytes))
        .unwrap_or(bytes(GB));
    let named: Vec<(String, u64)> = if let Some(item) = known {
        if !item.children.is_empty() {
            item.children.iter().map(|entry| (entry.name.clone(), entry.bytes)).collect()
        } else {
            invented(file_path, total)
        }
    } else {
        invented(file_path, total)
    };
    let entries = named
        .into_iter()
        .map(|(name, bytes)| FolderEntry {
            path: paths::join(&[file_path, &name]),
            kind: if looks_like_file(&name) { EntryKind::File } else { EntryKind::Folder },
            verdict: owner.verdict,
            summary: if owner.verdict == Verdict::Clear {
                "Inside a folder that is safe to clear. The app can rebuild it.".to_string()
            } else {
                "A folder inside this one.".to_string()
            },
            trashable: owner.trashable,
            measured: true,
            name,
            bytes,
        })
        .collect();
    FolderResult::ok(crate::model::FolderListing {
        path: file_path.to_string(),
        name: paths::basename(file_path),
        bytes: total,
        verdict: owner.verdict,
        summary: known.map(|item| item.summary.clone()).unwrap_or_else(|| "Files and folders inside this one, largest first.".to_string()),
        trashable: owner.trashable,
        entries,
        smaller_count: 7,
        smaller_bytes: ((total as f64) * 0.01).round() as u64,
        limited: false,
        measuring: false,
        token: 0,
    })
}

fn invented(file_path: &str, total: u64) -> Vec<(String, u64)> {
    let shares = [0.42, 0.24, 0.15, 0.09, 0.06, 0.04];
    let offset = (seed(file_path) % 3) as usize;
    INSIDE[offset..].iter().take(4).enumerate().map(|(index, name)| ((*name).to_string(), ((total as f64) * shares[index]).round() as u64)).collect()
}

pub fn demo_info(file_path: &str) -> ItemInfo {
    let value = seed(file_path) as i64;
    let now = crate::model::now_ms();
    ItemInfo {
        modified: now - (value % 20) * DAY - 3 * 3_600_000,
        created: Some(now - (300 + (value % 400)) * DAY),
        opened: if value % 3 == 0 { None } else { Some(now - (value % 9) * DAY) },
        items: Some(4 + (value as u64 % 60)),
        hidden: paths::basename(file_path).starts_with('.'),
        link: false,
    }
}

pub fn demo_icons(icons: &crate::icons::Icons, paths: &[String]) -> HashMap<String, FileIconSet> {
    let sample = icons.file_icons(vec!["/Library".to_string()]).remove("/Library");
    let Some(sample) = sample else { return HashMap::new() };
    if sample.light.is_empty() && sample.dark.is_empty() {
        return HashMap::new();
    }
    paths.iter().filter(|path| !looks_like_file(&paths::basename(path))).map(|path| (path.clone(), sample.clone())).collect()
}

pub fn expand_demo_home(file_path: &str) -> String {
    if let Some(rest) = file_path.strip_prefix('~') {
        format!("{HOME}{rest}")
    } else {
        file_path.to_string()
    }
}
