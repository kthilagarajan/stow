use crate::model::Verdict;

#[derive(Debug, Clone)]
pub struct ClassifiedFile {
    pub verdict: Verdict,
    pub trashable: bool,
    pub summary: String,
    pub detail: String,
}

fn labelled(verdict: Verdict, trashable: bool, summary: &str, detail: &str) -> ClassifiedFile {
    ClassifiedFile { verdict, trashable, summary: summary.to_string(), detail: detail.to_string() }
}

pub struct ParentClass {
    pub verdict: Verdict,
    pub trashable: bool,
    pub chosen: bool,
}

pub fn classify_large_file(file_path: &str) -> ClassifiedFile {
    let base = crate::paths::basename(file_path);
    let lower = file_path.to_lowercase();

    if lower.contains("/library/keychains/") || lower.contains("/library/preferences/") {
        return labelled(Verdict::Mandatory, false, "Account data. Leave it in place.", "Passwords or settings. Stow will not move this file.");
    }
    if lower.contains(".photoslibrary") || lower.contains("/pictures/") {
        return labelled(Verdict::Keep, false, "Part of your photos.", "This file is already counted with Pictures. Stow will not move it.");
    }
    if lower.contains("/documents/")
        || lower.contains("/desktop/")
        || lower.contains("/movies/")
        || lower.contains("/music/")
        || lower.contains("/library/mail/")
        || lower.contains("/library/messages/")
        || lower.contains("/library/mobile documents/")
    {
        return labelled(
            Verdict::Keep,
            false,
            "Your file. The Mac does not need it, and Stow will not move it.",
            &format!("Already counted inside its folder. {base}"),
        );
    }
    if lower.contains("/library/caches/") || lower.contains("/.npm/") || lower.contains("/deriveddata/") || lower.contains("/.trash/") {
        return labelled(
            Verdict::Clear,
            true,
            "A large cache, build leftover, or file already in the Trash.",
            "Clearing it frees space inside the folder that holds it. Apps recreate caches.",
        );
    }
    if lower.ends_with(".dmg") || lower.ends_with(".pkg") || lower.ends_with(".iso") {
        return labelled(
            Verdict::Optional,
            true,
            "A large installer. If the app is already installed, this is usually safe to clear.",
            "Already counted inside its folder.",
        );
    }
    if lower.contains("/node_modules/") {
        return labelled(
            Verdict::Optional,
            true,
            "A large installed dependency. The project stays. Install again if you need it.",
            "Already counted inside its project.",
        );
    }
    if lower.contains("/library/developer/coresimulator/") || lower.contains("devicesupport") {
        return labelled(
            Verdict::Optional,
            true,
            "Simulator or device-support data. Xcode can download or create it again.",
            "Anything that exists only inside a simulator goes with it.",
        );
    }
    if lower.contains("/library/android/") || lower.contains("/sdk/system-images/") {
        return labelled(
            Verdict::Optional,
            true,
            "An Android emulator image or SDK file. Android Studio can download it again.",
            "Stow will not remove the whole Android toolchain from here.",
        );
    }
    if lower.contains("/applications/") || lower.ends_with(".app") {
        return labelled(Verdict::Keep, false, "Part of an installed app. Stow will not uninstall it.", "Already counted with Applications.");
    }
    if lower.contains("/downloads/") {
        return labelled(Verdict::Optional, true, "A large download. Keep it if you still need the file.", "Already counted inside Downloads.");
    }
    labelled(
        Verdict::Optional,
        true,
        "A large file outside the usual folders. Open it before you decide.",
        "Already counted inside whatever folder holds it.",
    )
}

const PERSONAL: &[&str] = &[
    "/documents/",
    "/desktop/",
    "/pictures/",
    "/movies/",
    "/music/",
    "/library/mail/",
    "/library/messages/",
    "/library/mobile documents/",
];

fn cache_kind(name: &str) -> Option<Verdict> {
    let normalized = name.to_lowercase();
    if normalized.contains("extension") {
        return Some(Verdict::Optional);
    }
    if normalized == "cache"
        || normalized == "caches"
        || normalized == "cacheddata"
        || normalized == "gpucache"
        || normalized == "code cache"
        || normalized == "cachestorage"
        || normalized == "blob_storage"
        || normalized == "logs"
        || normalized == "crashpad"
        || normalized.ends_with(" cache")
        || normalized.contains("gpucache")
        || normalized.starts_with("dawn")
    {
        return Some(Verdict::Clear);
    }
    None
}

pub struct EntryClass {
    pub verdict: Verdict,
    pub trashable: bool,
    pub chosen: bool,
    pub summary: &'static str,
}

pub fn classify_entry(name: &str, full_path: &str, parent: &ParentClass) -> EntryClass {
    let lower_path = full_path.to_lowercase();
    let lower_name = name.to_lowercase();

    if lower_path.contains(".photoslibrary") || lower_name.ends_with(".app") || lower_path.contains(".app/") {
        return EntryClass { chosen: false, verdict: Verdict::Keep, trashable: false, summary: "Part of an app or a photo library. Stow will not move it." };
    }
    if lower_path.contains("/.cargo/") && (lower_name == "registry" || lower_name == "git") {
        return EntryClass { chosen: false, verdict: Verdict::Optional, trashable: true, summary: "Downloaded Rust crates. The next build fetches them again." };
    }

    if let Some(cache) = cache_kind(name) {
        if cache == Verdict::Clear {
            return EntryClass { chosen: false, verdict: Verdict::Clear, trashable: true, summary: "A cache. The app rebuilds it. Your documents stay." };
        }
        return EntryClass {
            chosen: false,
            verdict: Verdict::Optional,
            trashable: true,
            summary: "Cached app pieces. They download again if the app still wants them.",
        };
    }
    if lower_name == "node_modules" {
        return EntryClass {
            chosen: false,
            verdict: Verdict::Optional,
            trashable: true,
            summary: "Installed dependencies. The project stays. Install again if you need them.",
        };
    }
    if lower_name.ends_with(".dmg") || lower_name.ends_with(".pkg") || lower_name.ends_with(".iso") {
        return EntryClass {
            chosen: false,
            verdict: Verdict::Optional,
            trashable: true,
            summary: "An installer. If the app is already installed, this is usually safe to clear.",
        };
    }
    if parent.verdict == Verdict::Mandatory {
        return EntryClass { chosen: false, verdict: Verdict::Mandatory, trashable: false, summary: "The account needs this. Stow will not move it." };
    }
    if PERSONAL.iter().any(|fragment| lower_path.contains(fragment)) {
        return EntryClass { chosen: false, verdict: Verdict::Keep, trashable: false, summary: "Your files. Stow will not move them." };
    }
    if parent.verdict == Verdict::Clear {
        return EntryClass {
            chosen: false,
            verdict: Verdict::Clear,
            trashable: parent.trashable,
            summary: "Inside a folder that is safe to clear. The app can rebuild it.",
        };
    }
    if lower_path.contains("/library/application support/") || lower_path.contains("/library/containers/") {
        return EntryClass {
            chosen: false,
            verdict: Verdict::Optional,
            trashable: true,
            summary: "Data this app stored. Moving it can make the app forget this part. The app stays installed.",
        };
    }
    if parent.verdict == Verdict::Optional {
        return EntryClass { chosen: false, verdict: Verdict::Optional, trashable: parent.trashable, summary: "Inside an optional folder. Look at it before you move it." };
    }
    if parent.chosen {
        return EntryClass {
            chosen: true,
            verdict: Verdict::Keep,
            trashable: true,
            summary: "In a folder you opened. Stow does not know what this is, so look before you move it.",
        };
    }
    EntryClass { chosen: false, verdict: Verdict::Keep, trashable: false, summary: "Stow will not move this. Reveal it in Finder if you want to decide there." }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parent(verdict: Verdict, trashable: bool) -> ParentClass {
        ParentClass { verdict, trashable, chosen: false }
    }

    #[test]
    fn unknown_entries_in_a_chosen_folder_can_move() {
        let chosen = ParentClass { verdict: Verdict::Keep, trashable: true, chosen: true };
        let notes = classify_entry("notes", "/Users/alex/Projects/notes", &chosen);
        assert_eq!(notes.verdict, Verdict::Keep);
        assert!(notes.trashable && notes.chosen);
        let app = classify_entry("Tool.app", "/Users/alex/Projects/Tool.app", &chosen);
        assert!(!app.trashable);
        let personal = classify_entry("tax.pdf", "/Users/alex/Projects/Documents/tax.pdf", &chosen);
        assert!(!personal.trashable);
    }

    #[test]
    fn recognises_caches_dependencies_and_installers() {
        let cache = classify_entry("GPUCache", "/Users/alex/Library/Caches/App/GPUCache", &parent(Verdict::Keep, false));
        assert_eq!(cache.verdict, Verdict::Clear);
        assert!(cache.trashable);

        let modules = classify_entry("node_modules", "/Users/alex/Projects/app/node_modules", &parent(Verdict::Keep, false));
        assert_eq!(modules.verdict, Verdict::Optional);
        assert!(modules.trashable);

        let installer = classify_entry("Figma.dmg", "/Users/alex/Downloads/Figma.dmg", &parent(Verdict::Keep, false));
        assert_eq!(installer.verdict, Verdict::Optional);
        assert!(installer.trashable);

        let crates = classify_entry("registry", "/Users/alex/.cargo/registry", &parent(Verdict::Optional, false));
        assert_eq!(crates.verdict, Verdict::Optional);
        assert!(crates.trashable);
    }

    #[test]
    fn unknown_stays_keep_and_labelled_things_stay_protected() {
        let unknown = classify_entry("notes", "/Users/alex/Projects/notes", &parent(Verdict::Keep, false));
        assert_eq!(unknown.verdict, Verdict::Keep);
        assert!(!unknown.trashable);

        let app = classify_entry("Notes.app", "/Users/alex/Applications/Notes.app", &parent(Verdict::Clear, true));
        assert_eq!(app.verdict, Verdict::Keep);
        assert!(!app.trashable);

        let photos = classify_entry("Library.photoslibrary", "/Users/alex/Pictures/Library.photoslibrary", &parent(Verdict::Clear, true));
        assert_eq!(photos.verdict, Verdict::Keep);

        let personal = classify_entry("tax.pdf", "/Users/alex/Documents/tax.pdf", &parent(Verdict::Optional, true));
        assert_eq!(personal.verdict, Verdict::Keep);
        assert!(!personal.trashable);

        let account = classify_entry("login.keychain-db", "/Users/alex/Library/Keychains/login.keychain-db", &parent(Verdict::Mandatory, false));
        assert_eq!(account.verdict, Verdict::Mandatory);
        assert!(!account.trashable);

        let inside_clear = classify_entry("data", "/Users/alex/Library/Caches/App/data", &parent(Verdict::Clear, true));
        assert_eq!(inside_clear.verdict, Verdict::Clear);
        assert!(inside_clear.trashable);
    }

    #[test]
    fn large_files_follow_the_folder_they_sit_in() {
        let cache = classify_large_file("/Users/alex/Library/Caches/Google/huge.bin");
        assert_eq!(cache.verdict, Verdict::Clear);
        assert!(cache.trashable);
        let photo = classify_large_file("/Users/alex/Pictures/Library.photoslibrary/originals/IMG.mov");
        assert_eq!(photo.verdict, Verdict::Keep);
        assert!(!photo.trashable);
        let app = classify_large_file("/Applications/Xcode.app");
        assert_eq!(app.verdict, Verdict::Keep);
        assert!(!app.trashable);
    }
}
