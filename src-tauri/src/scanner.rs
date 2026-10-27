use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rayon::prelude::*;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

use crate::activity::{Activity, Busy};
use crate::catalog::{discover_roots, is_heavy, RootSpec};
use crate::classify::{classify_entry, classify_large_file, ParentClass};
use crate::describe::describe_child;
use crate::disk::{browse_pool, scan_pool, Walk};
use crate::exec::{self, Tracked};
use crate::guard::{self, TrashRecord};
use crate::items::apply_trash;
use crate::model::{
    now_ms, EntryKind, FolderEntry, FolderListing, FolderResult, FolderUpdate, SavedFolder, SavedFolderEntry, SavedScan, ScanEvent, SizeUpdate,
    StorageChild, StorageItem, TrashBatchResult, TrashResult, Verdict,
};
use crate::paths::{self, cmp_name};
use crate::store::{Db, TrashedPath};

const LARGE_FILE_BYTES: u64 = 500_000_000;
const PREVIEW_CHILDREN: usize = 16;
const SHOW_CAP: usize = 500;
const FILE_ROOTS: &[&str] = &["downloads", "desktop", "trash"];
const FLUSH_EVERY: Duration = Duration::from_millis(100);
const SAVE_EVERY: Duration = Duration::from_secs(1);
const NOT_MOVED: &str = "macOS did not move it. It may be in use, or protected.";

#[derive(Clone)]
struct MeasuredEntry {
    name: String,
    path: String,
    bytes: u64,
    kind: EntryKind,
    sized: bool,
}

#[derive(Clone)]
struct CachedListing {
    path: String,
    bytes: u64,
    entries: Vec<MeasuredEntry>,
    limited: bool,
    complete: bool,
    full: bool,
}

#[derive(Clone)]
struct Label {
    verdict: Verdict,
    trashable: bool,
    chosen: bool,
    summary: String,
}

/// A folder whose rows are still being measured. It lives inside `Inner`, so one lock guards all of it.
struct RunningJob {
    path: String,
    token: u64,
    generation: u64,
    class: Label,
    entries: Vec<MeasuredEntry>,
    // The size the scan already knew; zero means the header adds up rows as they arrive.
    known: u64,
    limited: bool,
    cancel: Arc<AtomicBool>,
}

impl RunningJob {
    fn bytes(&self) -> u64 {
        if self.known > 0 {
            self.known
        } else {
            self.entries.iter().filter(|entry| entry.sized).map(|entry| entry.bytes).sum()
        }
    }

    // Saved progress keeps only the size the scan knew, so a running total is never mistaken for the folder's size.
    fn partial(&self) -> CachedListing {
        self.listing(self.known)
    }

    fn listing(&self, bytes: u64) -> CachedListing {
        CachedListing { path: self.path.clone(), bytes, entries: self.entries.clone(), limited: self.limited, complete: false, full: true }
    }
}

struct Inner {
    registry: HashMap<String, TrashRecord>,
    listings: HashMap<String, CachedListing>,
    folders: HashMap<String, CachedListing>,
    running: HashMap<String, RunningJob>,
    sizes: HashMap<String, u64>,
    emitted: Vec<StorageItem>,
    removed: HashSet<String>,
    home: String,
    listing_tokens: HashMap<String, u64>,
}

struct Shared {
    app: AppHandle,
    db: Db,
    activity: Arc<Activity>,
    inner: Mutex<Inner>,
    processes: Mutex<Vec<Tracked>>,
    generation: AtomicU64,
    hydrated: watch::Sender<bool>,
}

#[derive(Clone)]
pub struct Scanner {
    shared: Arc<Shared>,
}

struct Approved {
    path: String,
    real: String,
    bytes: Option<u64>,
}

// The script reports AppleScript's error number on stdout, so a refusal can be told apart from a cancel.
const EMPTY_TRASH_SCRIPT: &str = "try\n  tell application \"Finder\" to empty trash\non error number n\n  return n\nend try\nreturn 0";

fn empty_trash_failure(code: Option<i32>) -> TrashResult {
    match code {
        // The person cancelled, so there is nothing to tell them.
        Some(-128) => TrashResult { ok: false, error: None, bytes: None },
        Some(-1743) => TrashResult::err(
            "Stow isn't allowed to control Finder, so nothing was deleted. Allow it in System Settings, Privacy & Security, Automation, then try again.",
        ),
        _ => TrashResult::err("Finder couldn't empty it, so nothing was deleted."),
    }
}

impl Scanner {
    pub fn new(app: AppHandle, db: Db, activity: Arc<Activity>) -> Self {
        Self {
            shared: Arc::new(Shared {
                app,
                db,
                activity,
                inner: Mutex::new(Inner {
                    registry: HashMap::new(),
                    listings: HashMap::new(),
                    folders: HashMap::new(),
                    running: HashMap::new(),
                    sizes: HashMap::new(),
                    emitted: Vec::new(),
                    removed: HashSet::new(),
                    home: paths::home_dir(),
                    listing_tokens: HashMap::new(),
                }),
                processes: Mutex::new(Vec::new()),
                generation: AtomicU64::new(0),
                hydrated: watch::Sender::new(false),
            }),
        }
    }

    pub fn hydrate(&self, items: Vec<StorageItem>) {
        let mut inner = lock(&self.shared.inner);
        for item in items {
            register(&mut inner, &item);
        }
    }

    pub fn hydrate_folders(&self, saved: Vec<SavedFolder>) {
        let mut inner = lock(&self.shared.inner);
        for folder in saved {
            if folder.path.is_empty() || (folder.entries.is_empty() && folder.bytes == 0 && !folder.complete) {
                continue;
            }
            // A folder measured since launch is newer than what was saved.
            if folder_listing(&inner, &folder.path).is_some() {
                continue;
            }
            let listing = CachedListing {
                path: folder.path.clone(),
                bytes: folder.bytes,
                limited: folder.limited,
                complete: folder.complete,
                full: true,
                entries: folder
                    .entries
                    .into_iter()
                    .map(|entry| MeasuredEntry {
                        sized: folder.complete || entry.sized,
                        name: entry.name,
                        path: entry.path,
                        bytes: entry.bytes,
                        kind: entry.kind,
                    })
                    .collect(),
            };
            if folder.complete && folder.bytes > 0 {
                note_size(&mut inner, &listing.path, listing.bytes);
            }
            for entry in &listing.entries {
                if entry.sized && entry.bytes > 0 {
                    note_size(&mut inner, &entry.path, entry.bytes);
                }
            }
            remember_folder(&mut inner, listing);
        }
    }

    /// Lets folder requests through once saved listings are loaded.
    pub fn ready(&self) {
        self.shared.hydrated.send_replace(true);
    }

    async fn hydrated(&self) {
        let mut ready = self.shared.hydrated.subscribe();
        let _ = ready.wait_for(|ready| *ready).await;
    }

    pub fn stop(&self) {
        self.shared.generation.fetch_add(1, Ordering::SeqCst);
        let tracked: Vec<Tracked> = lock(&self.shared.processes).drain(..).collect();
        for process in tracked {
            exec::kill_pid(process.pid, process.group);
        }
    }

    pub async fn start(&self) -> bool {
        self.stop();
        let generation = self.shared.generation.load(Ordering::SeqCst);
        let home = {
            let mut inner = lock(&self.shared.inner);
            inner.registry.clear();
            inner.listings.clear();
            inner.listing_tokens.clear();
            drop_running(&mut inner, None);
            inner.sizes.clear();
            inner.emitted.clear();
            inner.removed.clear();
            inner.home = paths::home_dir();
            inner.home.clone()
        };
        let current = {
            let shared = self.shared.clone();
            move || generation == shared.generation.load(Ordering::SeqCst)
        };
        let busy = Arc::new(self.shared.activity.begin("scan", None));
        let specs = tokio::task::spawn_blocking(move || discover_roots(&home)).await.unwrap_or_default();
        if !current() {
            return false;
        }
        let (light, heavy): (Vec<_>, Vec<_>) = specs.into_iter().partition(|spec| !is_heavy(spec));
        let total = (light.len() + heavy.len() + 2) as u32;
        let completed = Arc::new(AtomicU64::new(0));
        let limited = Arc::new(AtomicU64::new(0));
        busy.progress(None, 0, total);
        emit(
            &self.shared,
            generation,
            ScanEvent { kind: "start", total: Some(total), completed: Some(0), message: Some("Starting the scan".to_string()), item: None, limited: None },
        );
        let measure_one = {
            let shared = self.shared.clone();
            let completed = completed.clone();
            let limited = limited.clone();
            let busy = busy.clone();
            move |spec: RootSpec| {
                let shared = shared.clone();
                let completed = completed.clone();
                let limited = limited.clone();
                let busy = busy.clone();
                async move {
                    if generation != shared.generation.load(Ordering::SeqCst) {
                        return;
                    }
                    let done = completed.load(Ordering::SeqCst) as u32;
                    busy.progress(Some(spec.title.clone()), done, total);
                    emit(&shared, generation, status(format!("Measuring {}", spec.title), done, total));
                    match measure_root(shared.clone(), spec, generation).await {
                        Some(item) => {
                            if generation != shared.generation.load(Ordering::SeqCst) {
                                return;
                            }
                            if item.limited || !item.complete {
                                limited.fetch_add(1, Ordering::SeqCst);
                            }
                            publish_item(&shared, generation, item);
                        }
                        None => {
                            limited.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                    let done = completed.fetch_add(1, Ordering::SeqCst) as u32 + 1;
                    busy.progress(None, done, total);
                }
            }
        };
        pool(light, 4, measure_one.clone()).await;
        if !current() {
            return false;
        }
        pool(heavy, 2, measure_one).await;
        if !current() {
            return false;
        }
        let done = completed.load(Ordering::SeqCst) as u32;
        busy.progress(Some("Project dependencies".to_string()), done, total);
        emit(&self.shared, generation, status("Looking for project dependencies".to_string(), done, total));
        if let Some(dependencies) = find_dependencies(self.shared.clone(), generation).await {
            publish_item(&self.shared, generation, dependencies);
        }
        completed.fetch_add(1, Ordering::SeqCst);
        if !current() {
            return false;
        }
        let done = completed.load(Ordering::SeqCst) as u32;
        busy.progress(Some("Large files".to_string()), done, total);
        emit(&self.shared, generation, status("Looking for large files".to_string(), done, total));
        for item in find_large_files(self.shared.clone(), generation).await {
            publish_item(&self.shared, generation, item);
        }
        completed.fetch_add(1, Ordering::SeqCst);
        let (mut snapshot, removed, limited_count) = {
            let inner = lock(&self.shared.inner);
            (inner.emitted.clone(), inner.removed.clone(), limited.load(Ordering::SeqCst) as u32)
        };
        for path in removed {
            snapshot = apply_trash(snapshot, &path, 0);
        }
        let saved = SavedScan { scanned_at: now_ms(), limited: limited_count, items: snapshot };
        self.shared.db.write(move |store| {
            let _ = store.write_scan(&saved);
        });
        emit(
            &self.shared,
            generation,
            ScanEvent {
                kind: "done",
                limited: Some(limited_count),
                completed: Some(completed.load(Ordering::SeqCst) as u32),
                total: Some(total),
                message: Some("Scan finished".to_string()),
                item: None,
            },
        );
        true
    }

    pub async fn reveal(&self, file_path: &str) {
        let Some(real) = real_path(file_path) else { return };
        let owned = {
            let inner = lock(&self.shared.inner);
            owner(&inner, &real).is_some()
        };
        if owned {
            let _ = std::process::Command::new("open").args(["-R", &real]).spawn();
        }
    }

    fn approve(&self, file_path: &str) -> Result<Approved, String> {
        let Some(real) = real_path(file_path) else {
            return Err("That path is no longer there.".to_string());
        };
        let inner = lock(&self.shared.inner);
        let record = guard::lookup_record(&inner.registry, file_path).or_else(|| guard::lookup_record(&inner.registry, &real));
        guard::trash_decision(&real, &inner.home, record)?;
        Ok(Approved { path: file_path.to_string(), bytes: measured_size(&inner, &real), real })
    }

    fn moved(&self, approved: &Approved) {
        let mut inner = lock(&self.shared.inner);
        forget(&mut inner, &self.shared.db, &approved.real);
        inner.removed.insert(approved.path.clone());
        inner.removed.insert(approved.real.clone());
    }

    fn persist(&self, moved: &[&Approved]) {
        if moved.is_empty() {
            return;
        }
        let moved: Vec<TrashedPath> = moved.iter().map(|item| TrashedPath { path: item.path.clone(), bytes: item.bytes.unwrap_or(0) }).collect();
        self.shared.db.write(move |store| store.persist_trash(&moved));
    }

    pub async fn trash(&self, file_path: &str) -> TrashResult {
        let _busy = self.shared.activity.begin("trash", Some(paths::basename(file_path)));
        let approved = match self.approve(file_path) {
            Ok(approved) => approved,
            Err(error) => return TrashResult::err(error),
        };
        let real = approved.real.clone();
        let moved = tokio::task::spawn_blocking(move || trash::delete(&real).is_ok()).await.unwrap_or(false);
        if !moved {
            return TrashResult::err(NOT_MOVED);
        }
        self.moved(&approved);
        self.persist(&[&approved]);
        TrashResult::ok(approved.bytes)
    }

    pub async fn trash_many(&self, paths: Vec<String>) -> TrashBatchResult {
        let mut unique = Vec::new();
        for path in paths {
            if path.is_empty() || path.len() > 4096 || unique.contains(&path) {
                continue;
            }
            unique.push(path);
            if unique.len() == 200 {
                break;
            }
        }
        unique.sort_by_key(|path| path.len());
        let busy = self.shared.activity.begin("trash", None);
        busy.progress(None, 0, unique.len() as u32);
        let mut approved: Vec<Approved> = Vec::new();
        let mut inside: Vec<(String, usize)> = Vec::new();
        let mut error = None;
        for path in unique {
            if let Some(parent) = approved.iter().position(|item| path == item.path || path.starts_with(&format!("{}/", item.path))) {
                inside.push((path, parent));
                continue;
            }
            match self.approve(&path) {
                Ok(item) => approved.push(item),
                Err(reason) => {
                    error.get_or_insert(reason);
                }
            }
        }
        let reals: Vec<String> = approved.iter().map(|item| item.real.clone()).collect();
        let count = reals.len();
        let results = tokio::task::spawn_blocking(move || move_to_bin(&reals)).await.unwrap_or_else(|_| vec![false; count]);
        let mut trashed = Vec::new();
        let mut sizes = BTreeMap::new();
        let mut moved = Vec::new();
        for (item, ok) in approved.iter().zip(&results) {
            if !ok {
                error.get_or_insert(NOT_MOVED.to_string());
                continue;
            }
            self.moved(item);
            if let Some(bytes) = item.bytes {
                sizes.insert(item.path.clone(), bytes);
            }
            trashed.push(item.path.clone());
            moved.push(item);
        }
        for (path, parent) in inside {
            if results.get(parent) == Some(&true) {
                trashed.push(path);
            }
        }
        self.persist(&moved);
        TrashBatchResult { trashed, error, sizes: Some(sizes) }
    }

    pub async fn empty_trash(&self) -> TrashResult {
        let _busy = self.shared.activity.begin("empty-bin", None);
        let result = {
            let shared = self.shared.clone();
            tokio::task::spawn_blocking(move || {
                exec::run_command(
                    "osascript",
                    &["-e".to_string(), EMPTY_TRASH_SCRIPT.to_string()],
                    Duration::from_secs(180),
                    &shared.processes,
                    || true,
                )
            })
            .await
        };
        let Ok(result) = result else {
            return empty_trash_failure(None);
        };
        if result.code != Some(0) {
            return empty_trash_failure(None);
        }
        let code = result.stdout.trim().parse::<i32>().ok();
        if code != Some(0) {
            return empty_trash_failure(code);
        }
        let mut inner = lock(&self.shared.inner);
        let trash_path = paths::join(&[&inner.home, ".Trash"]);
        forget(&mut inner, &self.shared.db, &trash_path);
        TrashResult::ok(None)
    }

    pub async fn go_to(&self, file_path: &str) -> FolderResult {
        if !guard::valid_path(file_path) {
            return FolderResult::err("Type a folder path, like ~/Projects.");
        }
        let home = lock(&self.shared.inner).home.clone();
        let expanded = expand_tilde(file_path.trim(), &home);
        if !paths::is_absolute(&expanded) {
            return FolderResult::err("Start the path with / or ~/.");
        }
        let found = tokio::task::spawn_blocking(move || {
            let real = real_path(&expanded)?;
            let directory = std::fs::metadata(&real).map(|meta| meta.is_dir()).unwrap_or(false);
            let exists = std::fs::symlink_metadata(&real).is_ok();
            Some((real, directory, exists))
        })
        .await
        .ok()
        .flatten();
        let Some((real, directory, exists)) = found else {
            return FolderResult::err("There is no folder at that path.");
        };
        if !directory {
            return if exists { FolderResult::err("That is a file. Pick the folder it sits in.") } else { FolderResult::err("There is no folder at that path.") };
        }
        {
            let mut inner = lock(&self.shared.inner);
            if owner(&inner, &real).is_none() {
                // Unknown still means keep, but the person picked this folder, so its contents may go to the Bin with a warning.
                let chosen = guard::can_choose(&real, &inner.home);
                add_record(&mut inner, &real, Verdict::Keep, chosen, chosen);
            }
        }
        self.open_folder(&real).await
    }

    pub async fn open_folder(&self, file_path: &str) -> FolderResult {
        if !guard::valid_path(file_path) {
            return FolderResult::err("That path is not one Stow measured.");
        }
        self.hydrated().await;
        let probe = file_path.to_string();
        let found = tokio::task::spawn_blocking(move || {
            let real = real_path(&probe)?;
            let directory = std::fs::symlink_metadata(&real).ok()?.is_dir();
            Some((real, directory))
        })
        .await
        .ok()
        .flatten();
        let Some((real, directory)) = found else {
            return FolderResult::err("That folder is no longer there.");
        };
        let generation = self.shared.generation.load(Ordering::SeqCst);
        let (class, saved, known) = {
            let mut inner = lock(&self.shared.inner);
            let Some(owned) = owner(&inner, &real) else {
                return FolderResult::err("Stow has not measured that folder yet.");
            };
            if !directory {
                return FolderResult::err("That is a file. Reveal it in Finder to open it.");
            }
            let class = if owned.exact {
                Label { verdict: owned.verdict, trashable: owned.trashable, chosen: owned.chosen, summary: "Files and folders inside this one, largest first.".to_string() }
            } else {
                let classified = classify_entry(&paths::basename(&real), &real, &ParentClass { verdict: owned.verdict, trashable: owned.trashable, chosen: owned.chosen });
                add_record(&mut inner, &real, classified.verdict, classified.trashable, classified.chosen);
                Label { verdict: classified.verdict, trashable: classified.trashable, chosen: classified.chosen, summary: classified.summary.to_string() }
            };
            if let Some(job) = inner.running.get(&real).filter(|job| job.generation == generation) {
                return listing_from_job(&inner, job);
            }
            let saved = folder_listing(&inner, &real).cloned();
            if let Some(saved) = saved.as_ref().filter(|saved| saved.full && saved.complete) {
                register_entries(&mut inner, &saved.entries, &class);
                return listing_result(&inner, &real, &class, saved, false, 0);
            }
            let known = saved.as_ref().map(|listing| listing.bytes).filter(|bytes| *bytes > 0).or_else(|| known_size(&inner, &real)).unwrap_or(0);
            (class, saved, known)
        };
        let folder = real.clone();
        let Some(mut preview) = tokio::task::spawn_blocking(move || preview_entries(&folder)).await.ok().flatten() else {
            return FolderResult::err("Stow could not read that folder.");
        };
        if generation != self.shared.generation.load(Ordering::SeqCst) {
            return FolderResult::err("The scan started again. Open the folder once it finishes.");
        }
        if let Some(saved) = saved.as_ref() {
            reuse_sizes(&mut preview, &saved.entries);
        }
        let mut inner = lock(&self.shared.inner);
        if let Some(job) = inner.running.get(&real).filter(|job| job.generation == generation) {
            return listing_from_job(&inner, job);
        }
        if preview.is_empty() {
            let listing = CachedListing { path: real.clone(), bytes: known, entries: Vec::new(), limited: false, complete: true, full: true };
            return listing_result(&inner, &real, &class, &listing, false, 0);
        }
        abandon_unrelated(&self.shared, &mut inner, &real);
        let token = inner.listing_tokens.get(&real).copied().unwrap_or(0) + 1;
        inner.listing_tokens.insert(real.clone(), token);
        let cancel = Arc::new(AtomicBool::new(false));
        let job = RunningJob {
            path: real.clone(),
            token,
            generation,
            class: class.clone(),
            entries: preview,
            known,
            limited: saved.as_ref().map(|listing| listing.limited).unwrap_or(false),
            cancel: cancel.clone(),
        };
        register_entries(&mut inner, &job.entries, &class);
        let result = listing_from_job(&inner, &job);
        inner.running.insert(real.clone(), job);
        drop(inner);
        tokio::spawn(measure_folder(self.shared.clone(), real, token, generation, cancel));
        result
    }
}

struct Owner {
    verdict: Verdict,
    trashable: bool,
    chosen: bool,
    exact: bool,
}

// The nearest measured folder above the path. Walking up keeps this fast however much has been browsed.
fn owner(inner: &Inner, file_path: &str) -> Option<Owner> {
    if let Some(record) = guard::lookup_record(&inner.registry, file_path) {
        return Some(Owner { verdict: record.verdict, trashable: record.trashable, chosen: record.chosen, exact: true });
    }
    let mut best: Option<(usize, TrashRecord)> = None;
    for form in guard::path_keys(file_path) {
        let found = ancestors(&form).find_map(|ancestor| inner.registry.get(&ancestor).map(|record| (ancestor.len(), *record)));
        if let Some((depth, record)) = found {
            if best.map_or(true, |(best_depth, _)| depth > best_depth) {
                best = Some((depth, record));
            }
        }
    }
    best.map(|(_, record)| Owner { verdict: record.verdict, trashable: record.trashable, chosen: record.chosen, exact: false })
}

fn ancestors(file_path: &str) -> impl Iterator<Item = String> {
    let mut current = paths::trim_trailing_slash(file_path);
    std::iter::from_fn(move || {
        let parent = paths::dirname(&current);
        if parent == current || parent == "/" || parent == "." {
            return None;
        }
        current = parent.clone();
        Some(parent)
    })
}

fn add_record(inner: &mut Inner, file_path: &str, verdict: Verdict, trashable: bool, chosen: bool) {
    if file_path.is_empty() {
        return;
    }
    for key in guard::path_keys(file_path) {
        match inner.registry.get(&key).copied() {
            None => {
                inner.registry.insert(key, TrashRecord { verdict, trashable, chosen });
            }
            Some(existing) => {
                inner.registry.insert(
                    key,
                    TrashRecord {
                        verdict: guard::stricter_verdict(existing.verdict, verdict),
                        trashable: existing.trashable && trashable,
                        chosen: existing.chosen && chosen,
                    },
                );
            }
        }
    }
}

// Rows shown in a folder must be in the registry, or Move to Bin refuses them as unmeasured.
fn register_entries(inner: &mut Inner, entries: &[MeasuredEntry], class: &Label) {
    for entry in entries {
        let listed = to_folder_entry(inner, entry, class, entry.sized);
        add_record(inner, &listed.path, listed.verdict, listed.trashable, listed.chosen);
    }
}

fn register(inner: &mut Inner, item: &StorageItem) {
    let child_paths: HashSet<String> = item.children.iter().map(|child| paths::trim_trailing_slash(&child.path)).collect();
    if !item.path.is_empty() && !child_paths.contains(&paths::trim_trailing_slash(&item.path)) {
        add_record(inner, &item.path, item.verdict, item.trashable, false);
    }
    for child in &item.children {
        add_record(inner, &child.path, child.verdict, child.trashable, false);
    }
}

fn publish_item(shared: &Shared, generation: u64, item: StorageItem) {
    {
        let mut inner = lock(&shared.inner);
        register(&mut inner, &item);
        inner.emitted.retain(|entry| entry.id != item.id);
        inner.emitted.push(item.clone());
    }
    emit(shared, generation, ScanEvent { kind: "item", item: Some(item), total: None, completed: None, message: None, limited: None });
}

fn note_size(inner: &mut Inner, file_path: &str, bytes: u64) {
    for key in guard::path_keys(file_path) {
        inner.sizes.insert(key, bytes);
    }
}

fn known_size(inner: &Inner, file_path: &str) -> Option<u64> {
    guard::path_keys(file_path).into_iter().find_map(|key| inner.sizes.get(&key).copied())
}

fn measured_size(inner: &Inner, real_path: &str) -> Option<u64> {
    if let Some(size) = known_size(inner, real_path) {
        return Some(size);
    }
    cached_listing(inner, &paths::dirname(real_path)).and_then(|listing| listing.entries.iter().find(|entry| entry.path == real_path).map(|entry| entry.bytes))
}

fn inside_measured(inner: &Inner, file_path: &str) -> bool {
    guard::path_keys(file_path).iter().any(|form| ancestors(form).any(|ancestor| inner.sizes.contains_key(&ancestor)))
}

fn remember_folder(inner: &mut Inner, listing: CachedListing) {
    for key in guard::path_keys(&listing.path) {
        inner.folders.insert(key, listing.clone());
    }
}

fn folder_listing<'a>(inner: &'a Inner, file_path: &str) -> Option<&'a CachedListing> {
    guard::path_keys(file_path).into_iter().find_map(|key| inner.folders.get(&key))
}

fn remember_listing(inner: &mut Inner, listing: CachedListing) {
    for key in guard::path_keys(&listing.path) {
        inner.listings.insert(key, listing.clone());
    }
}

fn cached_listing<'a>(inner: &'a Inner, file_path: &str) -> Option<&'a CachedListing> {
    guard::path_keys(file_path).into_iter().find_map(|key| inner.listings.get(&key))
}

fn forget(inner: &mut Inner, db: &Db, real_path: &str) {
    let keys: HashSet<String> = guard::path_keys(real_path).into_iter().collect();
    inner.registry.retain(|key, _| {
        !(keys.contains(key) || key.starts_with(&format!("{real_path}/")) || keys.iter().any(|form| key.starts_with(&format!("{form}/"))))
    });
    let listing_keys: Vec<String> = inner.listings.keys().cloned().collect();
    for key in listing_keys {
        let Some(listing) = inner.listings.get(&key) else { continue };
        let listed = guard::path_keys(&listing.path);
        let related = keys.iter().any(|form| listed.iter().any(|item| item == form || item.starts_with(&format!("{form}/")) || form.starts_with(&format!("{item}/"))));
        if related {
            inner.listings.remove(&key);
        }
    }
    let folder_keys: Vec<String> = inner.folders.keys().cloned().collect();
    for key in folder_keys {
        let Some(listing) = inner.folders.get(&key) else { continue };
        if listing.path == real_path || listing.path.starts_with(&format!("{real_path}/")) || real_path.starts_with(&format!("{}/", listing.path)) {
            inner.folders.remove(&key);
        }
    }
    drop_running(inner, Some(real_path));
    let path = real_path.to_string();
    db.write(move |store| store.delete_folder(&path));
}

fn related(a: &str, b: &str) -> bool {
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

fn drop_running(inner: &mut Inner, prefix: Option<&str>) {
    let folders: Vec<String> = inner.running.keys().filter(|folder| prefix.map_or(true, |prefix| related(folder, prefix))).cloned().collect();
    for folder in folders {
        if let Some(job) = inner.running.remove(&folder) {
            job.cancel.store(true, Ordering::SeqCst);
        }
    }
}

// Opening a folder on another branch stops measuring the one left behind, so the disk works on what is on screen.
// What was already measured is kept, and opening that folder again measures only the rest.
fn abandon_unrelated(shared: &Shared, inner: &mut Inner, folder: &str) {
    let left: Vec<String> = inner.running.keys().filter(|path| !related(path, folder)).cloned().collect();
    for path in left {
        let Some(job) = inner.running.remove(&path) else { continue };
        job.cancel.store(true, Ordering::SeqCst);
        if folder_listing(inner, &path).is_some_and(|saved| saved.complete) {
            continue;
        }
        let listing = job.partial();
        remember_folder(inner, listing.clone());
        save(shared, &listing);
    }
}

fn reuse_sizes(preview: &mut [MeasuredEntry], saved: &[MeasuredEntry]) {
    let prior: HashMap<&str, &MeasuredEntry> = saved.iter().map(|entry| (entry.path.as_str(), entry)).collect();
    for entry in preview {
        if let Some(old) = prior.get(entry.path.as_str()) {
            if old.sized {
                entry.bytes = old.bytes;
                entry.sized = true;
            }
        }
    }
}

fn to_folder_entry(inner: &Inner, entry: &MeasuredEntry, parent: &Label, measured: bool) -> FolderEntry {
    let mut classified = classify_entry(&entry.name, &entry.path, &ParentClass { verdict: parent.verdict, trashable: parent.trashable, chosen: parent.chosen });
    if let Some(known) = guard::lookup_record(&inner.registry, &entry.path) {
        classified.verdict = known.verdict;
        classified.trashable = known.trashable;
        classified.chosen = known.chosen;
    }
    if classified.chosen && !guard::can_choose(&entry.path, &inner.home) {
        classified.trashable = false;
    }
    FolderEntry {
        name: entry.name.clone(),
        path: entry.path.clone(),
        bytes: entry.bytes,
        kind: entry.kind,
        verdict: classified.verdict,
        summary: classified.summary.to_string(),
        trashable: classified.trashable,
        chosen: classified.chosen,
        measured,
    }
}

fn listing_result(inner: &Inner, real: &str, class: &Label, measured: &CachedListing, measuring: bool, token: u64) -> FolderResult {
    let mut entries: Vec<FolderEntry> = measured
        .entries
        .iter()
        .map(|entry| {
            let known = if entry.sized { None } else { known_size(inner, &entry.path) };
            let mut row = entry.clone();
            if let Some(bytes) = known {
                row.bytes = bytes;
            }
            to_folder_entry(inner, &row, class, entry.sized || known.is_some())
        })
        .collect();
    entries.sort_by(|a, b| if measuring { cmp_name(&a.name, &b.name) } else { b.bytes.cmp(&a.bytes).then_with(|| cmp_name(&a.name, &b.name)) });
    let rest = if entries.len() > SHOW_CAP { entries.split_off(SHOW_CAP) } else { Vec::new() };
    let smaller_bytes = rest.iter().map(|entry| entry.bytes).sum();
    FolderResult::ok(FolderListing {
        path: real.to_string(),
        name: {
            let name = paths::basename(real);
            if name.is_empty() { real.to_string() } else { name }
        },
        bytes: measured.bytes,
        verdict: class.verdict,
        summary: class.summary.clone(),
        trashable: class.trashable,
        entries,
        smaller_count: rest.len() as u32,
        smaller_bytes,
        limited: measured.limited,
        measuring,
        token,
    })
}

fn listing_from_job(inner: &Inner, job: &RunningJob) -> FolderResult {
    listing_result(inner, &job.path, &job.class, &job.listing(job.bytes()), true, job.token)
}

fn preview_entries(folder: &str) -> Option<Vec<MeasuredEntry>> {
    let entries = std::fs::read_dir(folder).ok()?;
    Some(
        entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.is_empty() {
                    return None;
                }
                let directory = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
                Some(MeasuredEntry { path: paths::join(&[folder, &name]), kind: entry_kind(&name, !directory), name, bytes: 0, sized: false })
            })
            .collect(),
    )
}

fn entry_kind(name: &str, file: bool) -> EntryKind {
    if file {
        EntryKind::File
    } else if name.to_lowercase().ends_with(".app") {
        EntryKind::App
    } else {
        EntryKind::Folder
    }
}

fn file_bytes(file_path: &str) -> u64 {
    match std::fs::symlink_metadata(file_path) {
        Ok(meta) if meta.is_dir() => 0,
        Ok(meta) => meta.len(),
        Err(_) => 0,
    }
}

fn job_is(inner: &Inner, folder: &str, token: u64) -> bool {
    inner.running.get(folder).is_some_and(|job| job.token == token && !job.cancel.load(Ordering::SeqCst))
}

// Rows can be sized while they wait, when a folder opened inside this one finishes first.
fn row_sized(shared: &Shared, folder: &str, token: u64, index: usize) -> bool {
    let inner = lock(&shared.inner);
    inner.running.get(folder).filter(|job| job.token == token).and_then(|job| job.entries.get(index)).map_or(true, |entry| entry.sized)
}

fn record_size(shared: &Shared, folder: &str, token: u64, index: usize, file_path: &str, bytes: u64) -> bool {
    let mut inner = lock(&shared.inner);
    let Some(job) = inner.running.get_mut(folder).filter(|job| job.token == token) else { return false };
    let Some(entry) = job.entries.get_mut(index).filter(|entry| entry.path == file_path) else { return false };
    entry.bytes = bytes;
    entry.sized = true;
    true
}

async fn measure_folder(shared: Arc<Shared>, folder: String, token: u64, generation: u64, cancel: Arc<AtomicBool>) {
    let targets: Vec<(usize, String, EntryKind)> = {
        let inner = lock(&shared.inner);
        let Some(job) = inner.running.get(&folder).filter(|job| job.token == token) else { return };
        job.entries.iter().enumerate().filter(|(_, entry)| !entry.sized).map(|(index, entry)| (index, entry.path.clone(), entry.kind)).collect()
    };
    let total = targets.len() as u32;
    let batch = Arc::new(Mutex::new(Vec::<SizeUpdate>::new()));
    let done = Arc::new(AtomicU32::new(0));
    let finished = Arc::new(AtomicBool::new(false));
    let ticker = tokio::spawn(tick(shared.clone(), folder.clone(), token, total, batch.clone(), done.clone(), finished.clone()));
    let walker = shared.clone();
    let walked = folder.clone();
    let denied = tokio::task::spawn_blocking(move || {
        let stop = || cancel.load(Ordering::Relaxed) || generation != walker.generation.load(Ordering::SeqCst);
        let walk = Walk::new(&stop, None);
        browse_pool().install(|| {
            targets.par_iter().for_each(|(index, file_path, kind)| {
                if walk.halted() || row_sized(&walker, &walked, token, *index) {
                    return;
                }
                let bytes = if *kind == EntryKind::File { file_bytes(file_path) } else { walk.size(Path::new(file_path)) };
                if walk.halted() || !record_size(&walker, &walked, token, *index, file_path, bytes) {
                    return;
                }
                lock(&batch).push(SizeUpdate { path: file_path.clone(), bytes });
                done.fetch_add(1, Ordering::Relaxed);
            });
        });
        walk.denied()
    })
    .await
    .unwrap_or(false);
    finished.store(true, Ordering::SeqCst);
    let _ = ticker.await;
    finish_folder(&shared, &folder, token, generation, denied);
}

// Sends the sizes gathered since the last tick, keeps the activity list current, and saves progress now and then.
async fn tick(shared: Arc<Shared>, folder: String, token: u64, total: u32, batch: Arc<Mutex<Vec<SizeUpdate>>>, done: Arc<AtomicU32>, finished: Arc<AtomicBool>) {
    let busy: Busy = shared.activity.begin("folder", Some(paths::basename(&folder)));
    let mut saved_at = Instant::now();
    let mut saved_done = 0;
    loop {
        let last = finished.load(Ordering::SeqCst);
        if !flush_sizes(&shared, &folder, token, &batch) {
            return;
        }
        let measured = done.load(Ordering::Relaxed);
        busy.progress(None, measured, total);
        if last {
            return;
        }
        if measured != saved_done && saved_at.elapsed() >= SAVE_EVERY {
            save_partial(&shared, &folder, token);
            saved_at = Instant::now();
            saved_done = measured;
        }
        tokio::time::sleep(FLUSH_EVERY).await;
    }
}

fn flush_sizes(shared: &Shared, folder: &str, token: u64, batch: &Mutex<Vec<SizeUpdate>>) -> bool {
    let sizes = std::mem::take(&mut *lock(batch));
    let update = {
        let inner = lock(&shared.inner);
        let Some(job) = inner.running.get(folder).filter(|job| job.token == token) else { return false };
        if sizes.is_empty() {
            return true;
        }
        FolderUpdate {
            path: folder.to_string(),
            token,
            bytes: job.bytes(),
            sizes,
            entries: None,
            smaller_count: 0,
            smaller_bytes: 0,
            measuring: true,
            limited: job.limited,
        }
    };
    emit_folder(shared, update);
    true
}

fn save_partial(shared: &Shared, folder: &str, token: u64) {
    let listing = {
        let mut inner = lock(&shared.inner);
        let Some(job) = inner.running.get(folder).filter(|job| job.token == token) else { return };
        if folder_listing(&inner, folder).is_some_and(|saved| saved.complete) {
            return;
        }
        let listing = job.partial();
        remember_folder(&mut inner, listing.clone());
        listing
    };
    save(shared, &listing);
}

fn finish_folder(shared: &Shared, folder: &str, token: u64, generation: u64, denied: bool) {
    let mut inner = lock(&shared.inner);
    if generation != shared.generation.load(Ordering::SeqCst) || !job_is(&inner, folder, token) {
        return;
    }
    let Some(mut job) = inner.running.remove(folder) else { return };
    if denied {
        job.limited = true;
    }
    let mut unresolved = false;
    for entry in &mut job.entries {
        if entry.sized {
            continue;
        }
        match known_size(&inner, &entry.path) {
            Some(bytes) => {
                entry.bytes = bytes;
                entry.sized = true;
            }
            None => unresolved = true,
        }
    }
    job.known = 0;
    let bytes = job.bytes();
    job.entries.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| cmp_name(&a.name, &b.name)));
    let listing = CachedListing { path: job.path.clone(), bytes, entries: job.entries, limited: job.limited, complete: !unresolved, full: true };
    remember_folder(&mut inner, listing.clone());
    for entry in listing.entries.iter().filter(|entry| entry.sized) {
        note_size(&mut inner, &entry.path, entry.bytes);
    }
    let result = listing_result(&inner, folder, &job.class, &listing, false, token);
    if let Some(shown) = result.listing.as_ref() {
        for entry in &shown.entries {
            add_record(&mut inner, &entry.path, entry.verdict, entry.trashable, entry.chosen);
        }
    }
    drop(inner);
    save(shared, &listing);
    if listing.complete {
        bubble(shared, folder, bytes);
    }
    if let Some(shown) = result.listing {
        emit_folder(
            shared,
            FolderUpdate {
                path: folder.to_string(),
                token,
                bytes,
                sizes: Vec::new(),
                entries: Some(shown.entries),
                smaller_count: shown.smaller_count,
                smaller_bytes: shown.smaller_bytes,
                measuring: false,
                limited: shown.limited,
            },
        );
    }
}

// A finished folder passes its size to the folder above, whether that one is measuring or saved.
fn bubble(shared: &Shared, child_path: &str, bytes: u64) {
    let parent_path = paths::dirname(child_path);
    let mut inner = lock(&shared.inner);
    note_size(&mut inner, child_path, bytes);
    if parent_path.is_empty() || parent_path == child_path {
        return;
    }
    let generation = shared.generation.load(Ordering::SeqCst);
    if let Some(parent) = inner.running.get_mut(&parent_path) {
        if parent.generation != generation {
            return;
        }
        let Some(entry) = parent.entries.iter_mut().find(|entry| entry.path == child_path) else { return };
        entry.bytes = bytes;
        entry.sized = true;
        let update = FolderUpdate {
            path: parent.path.clone(),
            token: parent.token,
            bytes: parent.bytes(),
            sizes: vec![SizeUpdate { path: child_path.to_string(), bytes }],
            entries: None,
            smaller_count: 0,
            smaller_bytes: 0,
            measuring: true,
            limited: parent.limited,
        };
        drop(inner);
        emit_folder(shared, update);
        return;
    }
    let Some(saved_path) = folder_listing(&inner, &parent_path).map(|listing| listing.path.clone()) else { return };
    if paths::resolve(&saved_path) != paths::resolve(&parent_path) {
        return;
    }
    let key = guard::path_keys(&saved_path).into_iter().find(|key| inner.folders.contains_key(key));
    let Some(key) = key else { return };
    let Some(mut saved) = inner.folders.remove(&key) else { return };
    let Some(row) = saved.entries.iter_mut().find(|entry| entry.path == child_path) else {
        inner.folders.insert(key, saved);
        return;
    };
    row.bytes = bytes;
    row.sized = true;
    if saved.entries.iter().all(|entry| entry.sized) {
        saved.complete = true;
    }
    let token = inner.listing_tokens.get(&parent_path).copied().unwrap_or(0);
    let update = FolderUpdate {
        path: parent_path,
        token,
        bytes: saved.bytes,
        sizes: vec![SizeUpdate { path: child_path.to_string(), bytes }],
        entries: None,
        smaller_count: 0,
        smaller_bytes: 0,
        measuring: false,
        limited: saved.limited,
    };
    remember_folder(&mut inner, saved.clone());
    drop(inner);
    emit_folder(shared, update);
    save(shared, &saved);
}

fn save(shared: &Shared, listing: &CachedListing) {
    let folder = SavedFolder {
        path: listing.path.clone(),
        bytes: listing.bytes,
        limited: listing.limited,
        complete: listing.complete,
        entries: listing
            .entries
            .iter()
            .map(|entry| SavedFolderEntry { name: entry.name.clone(), path: entry.path.clone(), bytes: entry.bytes, kind: entry.kind, sized: entry.sized })
            .collect(),
    };
    shared.db.write(move |store| store.save_folder(&folder));
}

fn emit(shared: &Shared, generation: u64, event: ScanEvent) {
    if generation != shared.generation.load(Ordering::SeqCst) {
        return;
    }
    if let Some(window) = shared.app.get_webview_window("main") {
        let _ = window.emit("scan:event", &event);
    }
}

fn emit_folder(shared: &Shared, update: FolderUpdate) {
    if let Some(window) = shared.app.get_webview_window("main") {
        let _ = window.emit("folder:update", &update);
    }
}

fn status(message: String, completed: u32, total: u32) -> ScanEvent {
    ScanEvent { kind: "status", message: Some(message), completed: Some(completed), total: Some(total), item: None, limited: None }
}

fn real_path(file_path: &str) -> Option<String> {
    std::fs::canonicalize(file_path).ok().map(|path| path.to_string_lossy().to_string())
}

fn expand_tilde(file_path: &str, home: &str) -> String {
    if file_path == "~" {
        home.to_string()
    } else if let Some(rest) = file_path.strip_prefix("~/") {
        format!("{home}/{rest}")
    } else {
        file_path.to_string()
    }
}

// One Finder request for the whole batch. If it fails part way, each path is tried again on its own,
// and a path that is already gone counts as moved.
fn move_to_bin(reals: &[String]) -> Vec<bool> {
    if reals.is_empty() {
        return Vec::new();
    }
    if trash::delete_all(reals).is_ok() {
        return vec![true; reals.len()];
    }
    reals.iter().map(|real| trash::delete(real).is_ok() || std::fs::symlink_metadata(real).is_err()).collect()
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

async fn pool<T, F, Fut>(items: Vec<T>, limit: usize, f: F)
where
    T: Send + 'static,
    F: Fn(T) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    if items.is_empty() {
        return;
    }
    let f = Arc::new(f);
    let limit = limit.max(1).min(items.len());
    let semaphore = Arc::new(tokio::sync::Semaphore::new(limit));
    let mut tasks = Vec::new();
    for item in items {
        let f = f.clone();
        let semaphore = semaphore.clone();
        tasks.push(tokio::spawn(async move {
            let Ok(_permit) = semaphore.acquire_owned().await else { return };
            f(item).await;
        }));
    }
    for task in tasks {
        let _ = task.await;
    }
}

async fn measure_root(shared: Arc<Shared>, spec: RootSpec, generation: u64) -> Option<StorageItem> {
    let deadline = Instant::now() + Duration::from_millis(spec.timeout_ms);
    let walker = shared.clone();
    let root = spec.path.clone();
    let expand = spec.expand;
    let (total, dirs, limited, timed_out) = tokio::task::spawn_blocking(move || {
        let stop = || generation != walker.generation.load(Ordering::SeqCst);
        let walk = Walk::new(&stop, Some(deadline));
        let (total, dirs) = scan_pool().install(|| {
            if expand {
                let tree = walk.tree(Path::new(&root));
                (tree.total, tree.dirs)
            } else {
                (walk.size(Path::new(&root)), Vec::new())
            }
        });
        (total, dirs, walk.denied(), walk.timed_out())
    })
    .await
    .ok()?;
    if generation != shared.generation.load(Ordering::SeqCst) {
        return None;
    }
    let file_children = if spec.expand && FILE_ROOTS.contains(&spec.id.as_str()) { top_level_files(&spec.path).await } else { Vec::new() };
    if generation != shared.generation.load(Ordering::SeqCst) {
        return None;
    }
    let mut merged: HashMap<String, MeasuredEntry> = HashMap::new();
    for (dir_path, bytes) in dirs {
        let name = paths::basename(&dir_path);
        if name.is_empty() || bytes < 1 {
            continue;
        }
        let kind = entry_kind(&name, false);
        merged.insert(paths::resolve(&dir_path), MeasuredEntry { name, path: dir_path, bytes, kind, sized: true });
    }
    for file in file_children {
        merged.insert(paths::resolve(&file.path), file);
    }
    let mut entries: Vec<MeasuredEntry> = merged.into_values().collect();
    entries.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| cmp_name(&a.name, &b.name)));
    {
        let mut inner = lock(&shared.inner);
        if spec.expand {
            remember_listing(
                &mut inner,
                CachedListing { path: spec.path.clone(), bytes: total, entries: entries.clone(), limited: limited || timed_out, complete: true, full: false },
            );
        }
        note_size(&mut inner, &spec.path, total);
        for entry in &entries {
            note_size(&mut inner, &entry.path, entry.bytes);
        }
    }
    let parent = ParentClass { verdict: spec.verdict, trashable: spec.trashable, chosen: false };
    let children = entries.iter().filter(|entry| entry.bytes >= 1_000_000).take(PREVIEW_CHILDREN).map(|entry| child_of(&spec, entry, &parent)).collect();
    let mut detail = spec.detail.clone();
    if timed_out {
        detail.push_str(" Stow stopped measuring this folder so the rest of the scan could finish. The size may be low.");
    } else if limited {
        detail.push_str(" macOS hid some files here, so this size may be low.");
    }
    Some(StorageItem {
        id: spec.id,
        title: spec.title,
        path: spec.path,
        bytes: total,
        verdict: spec.verdict,
        group: spec.group,
        summary: spec.summary,
        detail,
        children,
        trashable: spec.trashable,
        lift_from_parent: spec.lift_from_parent,
        shadow: false,
        complete: !timed_out,
        limited,
    })
}

fn child_of(spec: &RootSpec, entry: &MeasuredEntry, parent: &ParentClass) -> StorageChild {
    let classified = classify_entry(&entry.name, &entry.path, parent);
    let described = describe_child(&spec.id, &entry.name);
    let trashable = spec.child_trash.map(|check| check(&entry.name)).unwrap_or(classified.trashable);
    StorageChild {
        name: entry.name.clone(),
        path: entry.path.clone(),
        bytes: entry.bytes,
        kind: Some(entry.kind),
        verdict: classified.verdict,
        summary: if classified.verdict == spec.verdict { described } else { classified.summary.to_string() },
        trashable,
    }
}

async fn top_level_files(dir: &str) -> Vec<MeasuredEntry> {
    let dir = dir.to_string();
    tokio::task::spawn_blocking(move || {
        let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
        let files: Vec<std::fs::DirEntry> = entries.flatten().filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file())).take(401).collect();
        if files.len() > 400 {
            return Vec::new();
        }
        files
            .into_iter()
            .filter_map(|entry| {
                let meta = entry.metadata().ok()?;
                if !meta.is_file() || meta.len() < 1_000_000 {
                    return None;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                Some(MeasuredEntry { path: paths::join(&[&dir, &name]), name, bytes: meta.len(), kind: EntryKind::File, sized: true })
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

async fn find_dependencies(shared: Arc<Shared>, generation: u64) -> Option<StorageItem> {
    let home = lock(&shared.inner).home.clone();
    let mut roots = Vec::new();
    for name in ["Projects", "Developer", "dev", "code", "src", "repos", "work", "playground"] {
        let full = paths::join(&[&home, name]);
        if tokio::fs::metadata(&full).await.is_ok() {
            roots.push(full);
        }
    }
    if roots.is_empty() || generation != shared.generation.load(Ordering::SeqCst) {
        return None;
    }
    let mut args = roots;
    args.extend(["-maxdepth".into(), "5".into(), "-type".into(), "d".into(), "-name".into(), "node_modules".into(), "-prune".into(), "-print".into()]);
    let shared_find = shared.clone();
    let found = tokio::task::spawn_blocking(move || {
        exec::run_command("find", &args, Duration::from_secs(20), &shared_find.processes, || generation == shared_find.generation.load(Ordering::SeqCst))
    })
    .await
    .ok()?;
    let paths: Vec<String> = found.stdout.lines().map(str::trim).filter(|line| !line.is_empty() && !line.contains("/Library/")).take(40).map(str::to_string).collect();
    let children = Arc::new(Mutex::new(Vec::new()));
    pool(paths, 3, {
        let shared = shared.clone();
        let children = children.clone();
        move |folder: String| {
            let shared = shared.clone();
            let children = children.clone();
            async move {
                if generation != shared.generation.load(Ordering::SeqCst) {
                    return;
                }
                let bytes = directory_bytes(shared.clone(), &folder, generation).await;
                if bytes < 1_000_000 {
                    return;
                }
                let project = paths::basename(&paths::dirname(&folder));
                lock(&children).push(StorageChild {
                    name: format!("{project}/node_modules"),
                    path: folder,
                    bytes,
                    kind: Some(EntryKind::Folder),
                    verdict: Verdict::Optional,
                    summary: describe_child("node-modules", &project),
                    trashable: true,
                });
            }
        }
    })
    .await;
    let mut children = lock(&children).clone();
    if children.is_empty() {
        return None;
    }
    children.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    let bytes = children.iter().map(|child| child.bytes).sum();
    Some(StorageItem {
        id: "node-modules".to_string(),
        title: "Project dependencies".to_string(),
        path: String::new(),
        bytes,
        verdict: Verdict::Optional,
        group: "Developer".to_string(),
        summary: "node_modules folders inside your projects. The projects stay.".to_string(),
        detail: "These are installed dependencies, not your source. Move one project’s folder to the Trash if you are not working on it. The next install downloads it again. The space is already inside the folder that holds the project.".to_string(),
        children,
        trashable: false,
        lift_from_parent: true,
        shadow: false,
        complete: !found.timed_out,
        limited: false,
    })
}

async fn find_large_files(shared: Arc<Shared>, generation: u64) -> Vec<StorageItem> {
    let home = lock(&shared.inner).home.clone();
    let shared_find = shared.clone();
    let query = format!("kMDItemFSSize >= {LARGE_FILE_BYTES}");
    let found = tokio::task::spawn_blocking(move || {
        exec::run_command("mdfind", &["-onlyin".to_string(), home, query], Duration::from_secs(15), &shared_find.processes, || {
            generation == shared_find.generation.load(Ordering::SeqCst)
        })
    })
    .await
    .ok();
    let Some(found) = found else { return Vec::new() };
    let paths: Vec<String> = found.stdout.lines().map(str::trim).filter(|line| !line.is_empty()).take(80).map(str::to_string).collect();
    let files = Arc::new(Mutex::new(Vec::new()));
    let budget = Arc::new(AtomicU64::new(8));
    pool(paths, 6, {
        let shared = shared.clone();
        let files = files.clone();
        let budget = budget.clone();
        move |file_path: String| {
            let shared = shared.clone();
            let files = files.clone();
            let budget = budget.clone();
            async move {
                if generation != shared.generation.load(Ordering::SeqCst) || lock(&files).len() >= 40 {
                    return;
                }
                let Ok(meta) = tokio::fs::symlink_metadata(&file_path).await else { return };
                if meta.file_type().is_symlink() {
                    return;
                }
                let bytes = if meta.is_file() {
                    meta.len()
                } else if meta.is_dir() {
                    let known = known_size(&lock(&shared.inner), &file_path);
                    if let Some(known) = known {
                        known
                    } else if inside_measured(&lock(&shared.inner), &file_path) {
                        return;
                    } else {
                        let claimed = budget.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| left.checked_sub(1)).is_ok();
                        if !claimed {
                            return;
                        }
                        directory_bytes(shared.clone(), &file_path, generation).await
                    }
                } else {
                    return;
                };
                if bytes < LARGE_FILE_BYTES {
                    return;
                }
                let classified = classify_large_file(&file_path);
                lock(&files).push(StorageItem {
                    id: format!("large:{file_path}"),
                    title: paths::basename(&file_path),
                    path: file_path,
                    bytes,
                    verdict: classified.verdict,
                    group: "Large files".to_string(),
                    summary: classified.summary,
                    detail: classified.detail,
                    children: Vec::new(),
                    trashable: classified.trashable,
                    lift_from_parent: false,
                    shadow: true,
                    complete: true,
                    limited: false,
                });
            }
        }
    })
    .await;
    let mut files = lock(&files).clone();
    files.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    files.truncate(40);
    files
}

async fn directory_bytes(shared: Arc<Shared>, folder: &str, generation: u64) -> u64 {
    if let Some(known) = known_size(&lock(&shared.inner), folder) {
        return known;
    }
    let walker = shared.clone();
    let root = folder.to_string();
    let total = tokio::task::spawn_blocking(move || {
        let stop = || generation != walker.generation.load(Ordering::SeqCst);
        let walk = Walk::new(&stop, Some(Instant::now() + Duration::from_secs(12)));
        scan_pool().install(|| walk.size(Path::new(&root)))
    })
    .await
    .unwrap_or(0);
    if total > 0 {
        note_size(&mut lock(&shared.inner), folder, total);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_trash_failure_is_quiet_only_on_cancel() {
        assert_eq!(empty_trash_failure(Some(-128)).error, None);
        assert!(empty_trash_failure(Some(-1743)).error.unwrap().contains("Automation"));
        assert!(empty_trash_failure(None).error.is_some());
    }
}
