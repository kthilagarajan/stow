use std::collections::{HashMap, HashSet};

use crate::model::Verdict;
use crate::paths;

#[derive(Debug, Clone, Copy)]
pub struct TrashRecord {
    pub verdict: Verdict,
    pub trashable: bool,
}

const NEVER_PREFIX: &[&str] = &[
    "/Library/Keychains",
    "/Library/Preferences",
    "/Library/Mail",
    "/Library/Messages",
    "/Library/Mobile Documents",
    "/Library/Accounts",
    "/Library/HomeKit",
    "/Library/IdentityServices",
    "/Library/Cookies",
    "/Library/Biome",
    "/Library/Photos",
    "/Library/Group Containers",
    "/Library/CloudStorage",
    "/Library/Finance",
    "/Library/com.apple.appleaccountd",
];

const NEVER_EXACT: &[&str] = &["/Library", "/Library/Application Support", "/Library/Developer", "/Library/Containers"];

pub fn stricter_verdict(a: Verdict, b: Verdict) -> Verdict {
    if rank(a) <= rank(b) { a } else { b }
}

fn rank(verdict: Verdict) -> u8 {
    match verdict {
        Verdict::Mandatory => 0,
        Verdict::Keep => 1,
        Verdict::Optional => 2,
        Verdict::Clear => 3,
    }
}

pub fn path_keys(file_path: &str) -> Vec<String> {
    let normalized = paths::trim_trailing_slash(file_path);
    let normalized = if normalized.is_empty() { "/".to_string() } else { normalized };
    let mut keys = HashSet::new();
    keys.insert(normalized.clone());
    let data_prefix = "/System/Volumes/Data";
    if normalized.starts_with("/Users/") {
        keys.insert(format!("{data_prefix}{normalized}"));
    }
    if normalized.starts_with(&format!("{data_prefix}/Users/")) {
        keys.insert(normalized[data_prefix.len()..].to_string());
    }
    keys.into_iter().collect()
}

pub fn home_forms(home: &str) -> Vec<String> {
    let normalized = paths::trim_trailing_slash(home);
    vec![normalized.clone(), format!("/System/Volumes/Data{normalized}")]
}

fn relative_to_home(real_path: &str, home: &str) -> Option<String> {
    let normalized = paths::trim_trailing_slash(real_path);
    for root in home_forms(home) {
        if normalized == root {
            return Some(String::new());
        }
        if normalized.starts_with(&format!("{root}/")) {
            return Some(normalized[root.len()..].to_string());
        }
    }
    None
}

pub fn lookup_record(registry: &HashMap<String, TrashRecord>, file_path: &str) -> Option<TrashRecord> {
    for key in path_keys(file_path) {
        if let Some(record) = registry.get(&key) {
            return Some(*record);
        }
    }
    None
}

pub fn trash_decision(real_path: &str, home: &str, record: Option<TrashRecord>) -> Result<(), String> {
    let Some(record) = record else {
        return Err("Stow did not measure that path.".to_string());
    };
    if !record.trashable || record.verdict == Verdict::Mandatory || record.verdict == Verdict::Keep {
        return Err("Stow will not move this. It is here to keep.".to_string());
    }

    let Some(relative) = relative_to_home(real_path, home) else {
        return Err("That folder is outside your home folder.".to_string());
    };
    if relative.is_empty() {
        return Err("That is your home folder.".to_string());
    }
    if NEVER_EXACT.contains(&relative.as_str())
        || NEVER_PREFIX.iter().any(|fragment| relative == *fragment || relative.starts_with(&format!("{fragment}/")))
    {
        return Err("Stow will not move that part of your Library.".to_string());
    }
    if relative.ends_with(".app") || relative.contains(".app/") {
        return Err("Stow will not uninstall an app.".to_string());
    }
    if relative.contains(".photoslibrary") {
        return Err("Stow will not move a photo library.".to_string());
    }
    Ok(())
}

pub fn valid_path(file_path: &str) -> bool {
    !file_path.is_empty() && file_path.len() <= 4096 && !file_path.contains('\0')
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "/Users/alex";

    fn allow(verdict: Verdict) -> TrashRecord {
        TrashRecord { verdict, trashable: true }
    }

    fn keep() -> TrashRecord {
        TrashRecord { verdict: Verdict::Keep, trashable: false }
    }

    #[test]
    fn refuses_unmeasured_keep_and_mandatory() {
        assert_eq!(trash_decision("/Users/alex/Library/Caches/npm", HOME, None).unwrap_err(), "Stow did not measure that path.");
        assert_eq!(
            trash_decision("/Users/alex/Documents", HOME, Some(keep())).unwrap_err(),
            "Stow will not move this. It is here to keep."
        );
        assert_eq!(
            trash_decision(
                "/Users/alex/Library/Caches/npm",
                HOME,
                Some(TrashRecord { verdict: Verdict::Clear, trashable: false })
            )
            .unwrap_err(),
            "Stow will not move this. It is here to keep."
        );
        assert_eq!(
            trash_decision("/Users/alex/Library/Keychains", HOME, Some(TrashRecord { verdict: Verdict::Mandatory, trashable: false }))
                .unwrap_err(),
            "Stow will not move this. It is here to keep."
        );
    }

    #[test]
    fn refuses_home_outside_library_apps_and_photos() {
        assert_eq!(trash_decision(HOME, HOME, Some(allow(Verdict::Clear))).unwrap_err(), "That is your home folder.");
        assert_eq!(
            trash_decision("/opt/homebrew", HOME, Some(allow(Verdict::Optional))).unwrap_err(),
            "That folder is outside your home folder."
        );
        for path in [
            "/Users/alex/Library",
            "/Users/alex/Library/Application Support",
            "/Users/alex/Library/Developer",
            "/Users/alex/Library/Containers",
            "/Users/alex/Library/Keychains",
            "/Users/alex/Library/Keychains/login.keychain-db",
            "/Users/alex/Library/Preferences",
            "/Users/alex/Library/Mail",
            "/Users/alex/Library/Messages/chat.db",
            "/Users/alex/Library/Photos/Libraries",
            "/Users/alex/Library/CloudStorage/Box",
            "/Users/alex/Library/Group Containers/group.com.example",
            "/Users/alex/Library/Mobile Documents/com~apple~CloudDocs",
            "/Users/alex/Library/com.apple.appleaccountd",
        ] {
            let error = trash_decision(path, HOME, Some(allow(Verdict::Clear))).unwrap_err();
            assert_eq!(error, "Stow will not move that part of your Library.", "{path}");
        }
        assert_eq!(
            trash_decision("/Users/alex/Applications/Notes.app", HOME, Some(allow(Verdict::Optional))).unwrap_err(),
            "Stow will not uninstall an app."
        );
        assert_eq!(
            trash_decision("/Users/alex/Applications/Notes.app/Contents/Info.plist", HOME, Some(allow(Verdict::Clear))).unwrap_err(),
            "Stow will not uninstall an app."
        );
        assert_eq!(
            trash_decision("/Users/alex/Pictures/Library.photoslibrary", HOME, Some(allow(Verdict::Optional))).unwrap_err(),
            "Stow will not move a photo library."
        );
        assert_eq!(
            trash_decision("/Users/alex/Pictures/Library.photoslibrary/originals", HOME, Some(allow(Verdict::Clear))).unwrap_err(),
            "Stow will not move a photo library."
        );
    }

    #[test]
    fn allows_measured_clear_and_optional_inside_home() {
        trash_decision("/Users/alex/Library/Caches/Google", HOME, Some(allow(Verdict::Clear))).unwrap();
        trash_decision("/Users/alex/.npm", HOME, Some(allow(Verdict::Clear))).unwrap();
        trash_decision("/Users/alex/Downloads/Figma.dmg", HOME, Some(allow(Verdict::Optional))).unwrap();
        trash_decision("/Users/alex/Projects/app/node_modules", HOME, Some(allow(Verdict::Optional))).unwrap();
        trash_decision("/System/Volumes/Data/Users/alex/Library/Caches/pip", HOME, Some(allow(Verdict::Clear))).unwrap();
    }

    #[test]
    fn path_keys_cover_the_data_volume() {
        let keys = path_keys("/Users/alex/Library/Caches");
        assert!(keys.contains(&"/Users/alex/Library/Caches".to_string()));
        assert!(keys.contains(&"/System/Volumes/Data/Users/alex/Library/Caches".to_string()));
        let back = path_keys("/System/Volumes/Data/Users/alex/.npm");
        assert!(back.contains(&"/Users/alex/.npm".to_string()));
    }

    #[test]
    fn stricter_verdict_keeps_the_safer_label() {
        assert_eq!(stricter_verdict(Verdict::Clear, Verdict::Keep), Verdict::Keep);
        assert_eq!(stricter_verdict(Verdict::Optional, Verdict::Mandatory), Verdict::Mandatory);
        assert_eq!(stricter_verdict(Verdict::Clear, Verdict::Optional), Verdict::Optional);
    }

    #[test]
    fn lookup_finds_either_path_form() {
        let mut registry = HashMap::new();
        registry.insert("/Users/alex/.npm".to_string(), allow(Verdict::Clear));
        assert!(lookup_record(&registry, "/System/Volumes/Data/Users/alex/.npm").is_some());
    }
}
