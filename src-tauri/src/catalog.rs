use crate::model::Verdict;
use crate::paths;

#[derive(Clone)]
pub struct RootSpec {
    pub id: String,
    pub title: String,
    pub path: String,
    pub verdict: Verdict,
    pub group: String,
    pub summary: String,
    pub detail: String,
    pub expand: bool,
    pub trashable: bool,
    pub lift_from_parent: bool,
    pub timeout_ms: u64,
    pub child_trash: Option<fn(&str) -> bool>,
}

fn spec(
    id: &str,
    title: &str,
    path: String,
    verdict: Verdict,
    group: &str,
    summary: &str,
    detail: &str,
    expand: bool,
    timeout_ms: u64,
    trashable: Option<bool>,
) -> RootSpec {
    let trashable = trashable.unwrap_or(verdict == Verdict::Clear || verdict == Verdict::Optional);
    RootSpec {
        id: id.to_string(),
        title: title.to_string(),
        path,
        verdict,
        group: group.to_string(),
        summary: summary.to_string(),
        detail: detail.to_string(),
        expand,
        trashable,
        lift_from_parent: false,
        timeout_ms,
        child_trash: None,
    }
}

fn xcode_spec(dir: &str, name: &str) -> RootSpec {
    let lower = name.to_lowercase();
    let full = paths::join(&[dir, name]);
    let mut built = if lower == "deriveddata" || lower.contains("cache") || lower == "index" || lower.contains("compilation") {
        spec(
            &format!("xcode:{name}"),
            name,
            full,
            Verdict::Clear,
            "Developer",
            "Build files Xcode recreates. Nothing you wrote lives here.",
            "Indexes, logs, and compiled products. Your source stays in the project. The next build takes longer. Moving this to the Trash is the usual fix when a build goes wrong.",
            true,
            75_000,
            Some(true),
        )
    } else if lower.contains("log") {
        spec(
            &format!("xcode:{name}"),
            name,
            full,
            Verdict::Clear,
            "Developer",
            "Xcode or device logs. Useful only while you are debugging.",
            "Logs are not your source and not a device backup. Apps and Xcode write them again.",
            true,
            75_000,
            Some(true),
        )
    } else if lower == "archives" {
        spec(
            &format!("xcode:{name}"),
            name,
            full,
            Verdict::Optional,
            "Developer",
            "Old builds kept for App Store uploads. Keep the latest if you still ship that app.",
            "Each archive is one exported build. The source project is elsewhere. You can archive again from the project. You cannot re-upload a build you throw away.",
            true,
            75_000,
            Some(true),
        )
    } else if lower.contains("devicesupport") {
        spec(
            &format!("xcode:{name}"),
            name,
            full,
            Verdict::Optional,
            "Developer",
            "Debug symbols for devices you have plugged in. Xcode downloads them again next time.",
            "Folders are named by OS version. They are large and replaceable. They are not a backup of the device.",
            true,
            75_000,
            Some(true),
        )
    } else if lower == "products" {
        spec(
            &format!("xcode:{name}"),
            name,
            full,
            Verdict::Optional,
            "Developer",
            "Build products Xcode stored beside DerivedData.",
            "These are compiled outputs. Your source is in the project. The next build can recreate them.",
            true,
            75_000,
            Some(true),
        )
    } else if lower == "userdata" {
        spec(
            &format!("xcode:{name}"),
            name,
            full,
            Verdict::Keep,
            "Developer",
            "Xcode window and account state.",
            "Themes, accounts, and IDE state. The Mac does not need this to start. Stow will not move it.",
            false,
            75_000,
            Some(false),
        )
    } else {
        spec(
            &format!("xcode:{name}"),
            name,
            full,
            Verdict::Optional,
            "Developer",
            "Part of Xcode’s support files. Stow does not treat it as safe to clear.",
            "It is not required to boot the Mac. Leave it unless you know you can replace it.",
            false,
            75_000,
            Some(false),
        )
    };
    built.lift_from_parent = false;
    let _ = &mut built;
    built
}

pub fn static_roots(home: &str) -> Vec<RootSpec> {
    let h = |parts: &[&str]| {
        let mut all = vec![home];
        all.extend_from_slice(parts);
        paths::join(&all)
    };
    let mut cargo = spec(
        "cargo",
        "Rust toolchain",
        h(&[".cargo"]),
        Verdict::Optional,
        "Developer",
        "The cargo command and downloaded crates.",
        "Stow will not remove the toolchain. The registry and git checkouts inside can go to the Trash. The next build downloads those crates again.",
        true,
        60_000,
        Some(false),
    );
    cargo.child_trash = Some(|name| name == "registry" || name == "git");

    vec![
        spec("keychains", "Passwords and certificates", h(&["Library/Keychains"]), Verdict::Mandatory, "Account", "Saved passwords and certificates. Your account needs these to sign in.", "Keychain holds credentials for this Mac. Stow will not move it.", false, 20_000, None),
        spec("preferences", "Settings", h(&["Library/Preferences"]), Verdict::Mandatory, "Account", "Settings apps remember: accounts, windows, and switches.", "Small files. Removing them makes apps forget how you set them up. Stow will not move them.", false, 30_000, None),
        spec("documents", "Documents", h(&["Documents"]), Verdict::Keep, "Your files", "Your documents. The Mac runs without them. Stow will not move them.", "Work, exports, and files you saved. They are not mandatory for macOS, and they are not optional clutter.", true, 90_000, None),
        spec("desktop", "Desktop", h(&["Desktop"]), Verdict::Keep, "Your files", "Files sitting on the Desktop. Stow will not move them.", "Often installers and half-finished work. Look in Large files if one of them is huge. Stow will not clear the Desktop for you.", true, 60_000, None),
        spec("pictures", "Pictures", h(&["Pictures"]), Verdict::Keep, "Your files", "Photos and images. The Mac starts without them. Stow will not move them.", "Includes the Photos library when it lives here. That library is your pictures, not a cache.", true, 120_000, None),
        spec("movies", "Movies", h(&["Movies"]), Verdict::Keep, "Your files", "Video on this Mac. Stow will not move it.", "Personal videos and files apps stored here. The system does not need them.", true, 120_000, None),
        spec("music", "Music", h(&["Music"]), Verdict::Keep, "Your files", "Music and the Apple Music library. Stow will not move them.", "The Media library can be large. It is your library, not a cache.", true, 120_000, None),
        spec("mail", "Mail", h(&["Library/Mail"]), Verdict::Keep, "Messages and mail", "Mail stored on this Mac. The system runs without it. Stow will not move it.", "Losing this folder loses mail that is not also on the server. Stow leaves it alone.", false, 120_000, None),
        spec("messages", "Messages", h(&["Library/Messages"]), Verdict::Keep, "Messages and mail", "iMessage history and attachments on this Mac.", "The Mac does not need Messages to start. Deleting this deletes local conversations. Stow will not move it.", false, 90_000, None),
        spec("icloud", "iCloud Drive", h(&["Library/Mobile Documents"]), Verdict::Keep, "Cloud", "iCloud Drive files cached on this Mac.", "Some of this may also live in iCloud. Stow will not evict or delete it. Sizes can include files that are not fully downloaded.", false, 90_000, None),
        spec("app-support", "App data", h(&["Library/Application Support"]), Verdict::Keep, "App data", "Documents and accounts apps stored for you. Stow will not remove this folder.", "Open an app, such as Cursor, to see each folder inside it. Caches can go to the Trash. Other folders are optional: moving one can make that app forget something, and the app stays installed.", true, 120_000, None),
        spec("applications", "Applications", "/Applications".to_string(), Verdict::Keep, "Applications", "Apps installed for everyone on this Mac. The system starts without the ones you added.", "Stow will not uninstall an app. If you do not use one, move that app to the Trash from Finder.", true, 120_000, None),
        spec("user-apps", "Your Applications", h(&["Applications"]), Verdict::Keep, "Applications", "Apps installed only for your account.", "The Mac starts without these. Stow will not uninstall them.", true, 60_000, None),
        spec("caches", "Caches", h(&["Library/Caches"]), Verdict::Clear, "Caches", "App caches. They come back when the app needs them.", "Browsers, package managers, and media apps keep temporary copies here. Your documents are not in this folder. Moving it to the Trash is reversible.", true, 90_000, None),
        spec("logs", "Logs", h(&["Library/Logs"]), Verdict::Clear, "Logs", "Diagnostic logs. Keep them only if something is crashing.", "Apps write these again. They are not your documents. Move them to the Trash when you are not chasing a bug.", true, 45_000, None),
        spec("trash", "Trash", h(&[".Trash"]), Verdict::Clear, "Trash", "Already deleted, and still taking space until you empty the Trash.", "Empty Trash on the left permanently deletes everything in the Trash. There is no way back. Stow asks before it does that.", true, 45_000, Some(false)),
        spec("npm", "npm cache", h(&[".npm"]), Verdict::Clear, "Developer", "Packages npm already downloaded. Your projects stay.", "The next install fetches what it needs. Clearing this does not remove node_modules inside a project.", true, 60_000, None),
        spec("downloads", "Downloads", h(&["Downloads"]), Verdict::Optional, "Downloads", "Files you saved and may not have filed anywhere else.", "Installers are usually safe once the app is installed. Other files may be the only copy. Open a row before you move it.", true, 60_000, None),
        spec("ios-backups", "iPhone and iPad backups", h(&["Library/Application Support/MobileSync/Backup"]), Verdict::Optional, "Backups", "Local device backups. Keep the one you would restore from.", "If iCloud is not holding this device, the Trash becomes the only copy until you put it back. These are not required to boot the Mac.", false, 90_000, None),
        spec("simulators", "iOS Simulators", h(&["Library/Developer/CoreSimulator"]), Verdict::Optional, "Developer", "Simulator devices. Xcode can create them again.", "Anything you saved only inside a simulator goes with it. Your app’s source code is not in here.", true, 90_000, None),
        spec("docker", "Docker", h(&["Library/Containers/com.docker.docker"]), Verdict::Optional, "Developer", "Docker’s virtual disk. Local images and containers live here.", "Moving this to the Trash deletes local images and containers. It does not uninstall Docker. Docker recreates an empty disk, not your containers.", false, 60_000, None),
        spec("colima", "Colima", h(&[".colima"]), Verdict::Optional, "Developer", "Colima’s Linux virtual machine.", "Moving this deletes that local VM. Colima can create a new one. It will not restore containers you do not have elsewhere.", false, 45_000, None),
        spec("pnpm", "pnpm store", h(&["Library/pnpm"]), Verdict::Optional, "Developer", "pnpm’s shared package store. Projects re-link from it.", "Removing it means the next install downloads packages again. Your project folders stay.", false, 60_000, None),
        spec("pnpm-local", "pnpm store", h(&[".local/share/pnpm"]), Verdict::Optional, "Developer", "Another pnpm store. Projects re-link from it.", "Removing it means the next install downloads packages again. Your project folders stay.", false, 45_000, None),
        cargo,
        spec("go", "Go module cache", h(&["go/pkg"]), Verdict::Optional, "Developer", "Modules Go already downloaded.", "The next build downloads modules again. Your Go projects stay. This is not the Go application itself if you installed Go elsewhere.", false, 60_000, None),
        spec("android", "Android SDK", h(&["Library/Android"]), Verdict::Optional, "Developer", "Android SDK and emulator images.", "Stow will not remove the toolchain. Large system images show under Large files, and those can be downloaded again from Android Studio.", false, 90_000, Some(false)),
        spec("homebrew", "Homebrew", "/opt/homebrew".to_string(), Verdict::Optional, "Developer", "The Homebrew prefix and the tools you installed with it.", "Stow shows the size and will not remove it. Use brew cleanup for stale downloads. Those usually live in Caches.", false, 90_000, Some(false)),
        spec("homebrew-intel", "Homebrew Cellar", "/usr/local/Cellar".to_string(), Verdict::Optional, "Developer", "Tools installed with Homebrew under /usr/local.", "Stow shows the size and will not remove them. Uninstall formulae with brew if you want the space back.", false, 90_000, Some(false)),
    ]
}

pub fn discover_roots(home: &str) -> Vec<RootSpec> {
    let mut specs = static_roots(home);
    let xcode_dir = paths::join(&[home, "Library/Developer/Xcode"]);
    if let Ok(entries) = std::fs::read_dir(&xcode_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.is_empty() {
                continue;
            }
            specs.push(xcode_spec(&xcode_dir, &name));
        }
    }
    specs
        .into_iter()
        .filter(|spec| match std::fs::metadata(&spec.path) {
            Ok(_) => true,
            Err(error) => error.kind() != std::io::ErrorKind::NotFound,
        })
        .collect()
}

pub fn is_heavy(spec: &RootSpec) -> bool {
    const HEAVY: &[&str] = &[
        "pictures",
        "movies",
        "music",
        "mail",
        "messages",
        "icloud",
        "documents",
        "app-support",
        "applications",
        "caches",
        "simulators",
        "homebrew",
        "homebrew-intel",
        "docker",
        "android",
        "ios-backups",
    ];
    HEAVY.contains(&spec.id.as_str()) || spec.id.starts_with("xcode:")
}
