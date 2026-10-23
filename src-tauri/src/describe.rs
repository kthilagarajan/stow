fn known_cache(name: &str) -> Option<&'static str> {
    Some(match name {
        "Google" => "Chrome and other Google caches. They come back as you browse. Bookmarks are not in here.",
        "Homebrew" => "Old Homebrew downloads. The next install fetches what it needs. Installed tools stay.",
        "pip" => "Python package downloads. pip fetches them again when a project asks.",
        "Yarn" => "Yarn’s package cache. Your projects keep their own files.",
        "com.apple.Safari" => "Safari’s cache. History and bookmarks live elsewhere.",
        "com.apple.Music" => "Apple Music’s cache. Your library is in the Music folder.",
        "com.spotify.client" => "Spotify’s cache. Playlists stay. Songs may stream again.",
        "com.tinyspeck.slackmacgap" => "Slack’s cache. Your messages stay.",
        "Cursor" => "Cursor’s cache. Projects and settings stay.",
        "typescript" => "TypeScript’s cache. The next compile rebuilds it.",
        "node-gyp" => "Native-module build cache. The next rebuild recreates it.",
        "com.apple.dt.Xcode" => "Xcode’s cache. The next build recreates it.",
        _ => return None,
    })
}

fn download_copy(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.ends_with(".dmg") || lower.ends_with(".pkg") || lower.ends_with(".iso") {
        "An installer. If the app is already installed, this is usually safe to clear."
    } else if lower.ends_with(".zip") || lower.ends_with(".gz") || lower.ends_with(".tar") || lower.ends_with(".tgz") {
        "An archive. Keep it if you have not unpacked it somewhere you still use."
    } else {
        "A download. Keep it if you have not filed it somewhere else."
    }
}

pub fn describe_child(spec_id: &str, name: &str) -> String {
    if name.ends_with(".photoslibrary") {
        return "Your photo library. The Mac starts without it, and Stow will not move it.".to_string();
    }
    if spec_id == "caches" {
        if let Some(known) = known_cache(name) {
            return known.to_string();
        }
        if let Some(rest) = name.strip_prefix("com.apple.") {
            return format!("Apple cache for {rest}. The app rebuilds it.");
        }
        return "An app cache. The app rebuilds it if it still needs it. Documents are not stored here.".to_string();
    }
    if spec_id == "logs" {
        if name == "DiagnosticReports" {
            return "Crash reports. Useful only while you are chasing a bug.".to_string();
        }
        return "Log files. Safe to clear unless you are diagnosing a problem right now.".to_string();
    }
    if spec_id == "downloads" {
        return download_copy(name).to_string();
    }
    if spec_id == "trash" {
        return "Already in the Trash. Empty Trash on the left when you are sure. That step is permanent.".to_string();
    }
    if spec_id == "applications" || spec_id == "user-apps" {
        return "An installed app. Stow will not uninstall it. Move it to the Trash from Finder if you no longer use it.".to_string();
    }
    if spec_id == "app-support" {
        return format!("Files {name} stored. Open it to see each folder, then decide what can go.");
    }
    if spec_id == "pictures" {
        return "Something in Pictures. Stow will not move your photos.".to_string();
    }
    if spec_id == "documents" || spec_id == "desktop" || spec_id == "movies" || spec_id == "music" {
        return "Your files. The Mac does not need them, and Stow will not move them.".to_string();
    }
    if spec_id == "cargo" {
        if name == "registry" || name == "git" {
            return "Downloaded Rust crates. The next build fetches them again. The cargo command stays.".to_string();
        }
        return "Part of the Rust toolchain. Stow leaves it in place.".to_string();
    }
    if let Some(_rest) = spec_id.strip_prefix("xcode:") {
        let lower = name.to_lowercase();
        if lower.contains("devicesupport") {
            return "Symbols for one device. Xcode downloads them again when you connect it.".to_string();
        }
        if name.ends_with(".xcarchive") {
            return "One archived build. Keep it if you still need to upload that version.".to_string();
        }
        return "A folder inside this Xcode support directory.".to_string();
    }
    if spec_id == "simulators" {
        return "One simulator device. You can add it again from Xcode. Data saved only inside it goes too.".to_string();
    }
    if spec_id == "node-modules" {
        return "Dependencies for this project. The project stays. Install again when you need them.".to_string();
    }
    "A folder inside this one.".to_string()
}
