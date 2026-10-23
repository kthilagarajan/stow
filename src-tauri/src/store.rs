use std::path::Path;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};

use crate::items::{add_to_trash, apply_trash, clear_trash, freed_bytes};
use crate::model::{EntryKind, SavedFolder, SavedFolderEntry, SavedScan, StorageChild, StorageItem, Verdict};

pub struct Store {
    conn: Connection,
}

type Write = Box<dyn FnOnce(&mut Store) + Send>;

/// Shared access to `stow.sqlite`. Writes run in order on one thread, so callers never wait on the disk.
#[derive(Clone)]
pub struct Db {
    store: Arc<Mutex<Store>>,
    writes: Sender<Write>,
}

impl Db {
    pub fn new(store: Store) -> Self {
        let store = Arc::new(Mutex::new(store));
        let (writes, queue) = mpsc::channel::<Write>();
        let writer = store.clone();
        std::thread::Builder::new()
            .name("stow-store".to_string())
            .spawn(move || {
                for write in queue {
                    let mut store = writer.lock().unwrap_or_else(|poison| poison.into_inner());
                    write(&mut store);
                }
            })
            .expect("Stow could not start its store thread");
        Self { store, writes }
    }

    /// Blocks while SQLite reads, so call it from a blocking thread.
    pub fn read<T>(&self, read: impl FnOnce(&Store) -> T) -> T {
        let store = self.store.lock().unwrap_or_else(|poison| poison.into_inner());
        read(&store)
    }

    pub fn write(&self, write: impl FnOnce(&mut Store) + Send + 'static) {
        let _ = self.writes.send(Box::new(write));
    }
}

pub struct TrashedPath {
    pub path: String,
    pub bytes: u64,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let conn = Connection::open(path).map_err(|error| error.to_string())?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS scan (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              scanned_at INTEGER NOT NULL,
              limited INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS folder (
              path TEXT PRIMARY KEY,
              bytes INTEGER NOT NULL,
              limited INTEGER NOT NULL,
              complete INTEGER NOT NULL,
              entries TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS item (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              path TEXT NOT NULL,
              bytes INTEGER NOT NULL,
              verdict TEXT NOT NULL,
              grp TEXT NOT NULL,
              summary TEXT NOT NULL,
              detail TEXT NOT NULL,
              trashable INTEGER NOT NULL,
              lift_from_parent INTEGER NOT NULL,
              shadow INTEGER NOT NULL,
              complete INTEGER NOT NULL,
              limited INTEGER NOT NULL,
              children TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| error.to_string())?;
        Ok(Self { conn })
    }

    pub fn read_scan(&self) -> Option<SavedScan> {
        let scan = self
            .conn
            .query_row("SELECT scanned_at, limited FROM scan WHERE id = 1", [], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .optional()
            .ok()
            .flatten()?;
        let mut statement = self.conn.prepare("SELECT id, title, path, bytes, verdict, grp, summary, detail, trashable, lift_from_parent, shadow, complete, limited, children FROM item").ok()?;
        let rows = statement
            .query_map([], |row| {
                Ok(ItemRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    path: row.get(2)?,
                    bytes: row.get(3)?,
                    verdict: row.get(4)?,
                    group: row.get(5)?,
                    summary: row.get(6)?,
                    detail: row.get(7)?,
                    trashable: row.get(8)?,
                    lift_from_parent: row.get(9)?,
                    shadow: row.get(10)?,
                    complete: row.get(11)?,
                    limited: row.get(12)?,
                    children: row.get(13)?,
                })
            })
            .ok()?;
        let items = rows.filter_map(|row| row.ok().and_then(|row| row.into_item())).collect();
        Some(SavedScan { scanned_at: scan.0, limited: scan.1.max(0) as u32, items })
    }

    pub fn write_scan(&mut self, scan: &SavedScan) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|error| error.to_string())?;
        tx.execute("DELETE FROM item", []).map_err(|error| error.to_string())?;
        for item in &scan.items {
            tx.execute(
                "INSERT INTO item (
                    id, title, path, bytes, verdict, grp, summary, detail,
                    trashable, lift_from_parent, shadow, complete, limited, children
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    item.id,
                    item.title,
                    item.path,
                    item.bytes as i64,
                    item.verdict.as_str(),
                    item.group,
                    item.summary,
                    item.detail,
                    item.trashable as i64,
                    item.lift_from_parent as i64,
                    item.shadow as i64,
                    item.complete as i64,
                    item.limited as i64,
                    serde_json::to_string(&item.children).unwrap_or_else(|_| "[]".to_string()),
                ],
            )
            .map_err(|error| error.to_string())?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO scan (id, scanned_at, limited) VALUES (1, ?1, ?2)",
            params![scan.scanned_at, scan.limited as i64],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())
    }

    pub fn clear_measured_trash(&mut self) {
        let Some(current) = self.read_scan() else { return };
        let items = clear_trash(current.items);
        let _ = self.write_scan(&SavedScan { items, ..current });
    }

    pub fn read_folders(&self) -> Vec<SavedFolder> {
        let Ok(mut statement) = self.conn.prepare("SELECT path, bytes, limited, complete, entries FROM folder") else {
            return Vec::new();
        };
        let Ok(rows) = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        }) else {
            return Vec::new();
        };
        rows.filter_map(|row| {
            let (path, bytes, limited, complete, entries) = row.ok()?;
            if path.is_empty() {
                return None;
            }
            Some(SavedFolder {
                path,
                bytes: bytes.max(0) as u64,
                limited: limited == 1,
                complete: complete == 1,
                entries: parse_entries(&entries),
            })
        })
        .collect()
    }

    pub fn save_folder(&self, folder: &SavedFolder) {
        if folder.path.is_empty() {
            return;
        }
        let _ = self.conn.execute(
            "INSERT INTO folder (path, bytes, limited, complete, entries) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET bytes = excluded.bytes, limited = excluded.limited, complete = excluded.complete, entries = excluded.entries
             WHERE folder.complete = 0 OR excluded.complete = 1",
            params![
                folder.path,
                folder.bytes as i64,
                folder.limited as i64,
                folder.complete as i64,
                serde_json::to_string(&folder.entries).unwrap_or_else(|_| "[]".to_string()),
            ],
        );
    }

    pub fn delete_folder(&self, folder_path: &str) {
        if folder_path.is_empty() {
            return;
        }
        let _ = self.conn.execute(
            "DELETE FROM folder WHERE path = ?1 OR substr(path, 1, length(?1) + 1) = ?1 || '/'",
            params![folder_path],
        );
    }

    pub fn persist_trash(&mut self, moved: &[TrashedPath]) {
        if moved.is_empty() {
            return;
        }
        let Some(current) = self.read_scan() else { return };
        let mut items = current.items;
        for entry in moved {
            let bytes = {
                let freed = freed_bytes(&items, &entry.path);
                if freed == 0 { entry.bytes } else { freed }
            };
            items = add_to_trash(apply_trash(items, &entry.path, entry.bytes), bytes);
        }
        let _ = self.write_scan(&SavedScan { items, ..current });
    }
}

struct ItemRow {
    id: String,
    title: String,
    path: String,
    bytes: i64,
    verdict: String,
    group: String,
    summary: String,
    detail: String,
    trashable: i64,
    lift_from_parent: i64,
    shadow: i64,
    complete: i64,
    limited: i64,
    children: String,
}

impl ItemRow {
    fn into_item(self) -> Option<StorageItem> {
        Some(StorageItem {
            id: self.id,
            title: self.title,
            path: self.path,
            bytes: self.bytes.max(0) as u64,
            verdict: parse_verdict(&self.verdict)?,
            group: self.group,
            summary: self.summary,
            detail: self.detail,
            children: parse_children(&self.children),
            trashable: self.trashable == 1,
            lift_from_parent: self.lift_from_parent == 1,
            shadow: self.shadow == 1,
            complete: self.complete == 1,
            limited: self.limited == 1,
        })
    }
}

fn parse_verdict(value: &str) -> Option<Verdict> {
    Some(match value {
        "mandatory" => Verdict::Mandatory,
        "keep" => Verdict::Keep,
        "optional" => Verdict::Optional,
        "clear" => Verdict::Clear,
        _ => return None,
    })
}

fn parse_kind(value: Option<&str>) -> EntryKind {
    match value {
        Some("file") => EntryKind::File,
        Some("app") => EntryKind::App,
        _ => EntryKind::Folder,
    }
}

fn parse_children(raw: &str) -> Vec<StorageChild> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else { return Vec::new() };
    let Some(list) = value.as_array() else { return Vec::new() };
    list.iter()
        .filter_map(|entry| {
            let name = entry.get("name")?.as_str()?.to_string();
            let path = entry.get("path")?.as_str()?.to_string();
            let verdict = parse_verdict(entry.get("verdict")?.as_str()?)?;
            let bytes = entry.get("bytes").and_then(|value| value.as_u64()).unwrap_or(0);
            let summary = entry.get("summary").and_then(|value| value.as_str()).unwrap_or("").to_string();
            let trashable = entry.get("trashable").and_then(|value| value.as_bool()).unwrap_or(false);
            let kind = entry.get("kind").and_then(|value| value.as_str()).and_then(|kind| match kind {
                "file" => Some(EntryKind::File),
                "folder" => Some(EntryKind::Folder),
                "app" => Some(EntryKind::App),
                _ => None,
            });
            Some(StorageChild { name, path, bytes, verdict, summary, trashable, kind })
        })
        .collect()
}

fn parse_entries(raw: &str) -> Vec<SavedFolderEntry> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else { return Vec::new() };
    let Some(list) = value.as_array() else { return Vec::new() };
    list.iter()
        .filter_map(|entry| {
            let name = entry.get("name")?.as_str()?.to_string();
            let path = entry.get("path")?.as_str()?.to_string();
            let bytes = entry.get("bytes").and_then(|value| value.as_u64()).unwrap_or(0);
            let kind = parse_kind(entry.get("kind").and_then(|value| value.as_str()));
            let sized = entry.get("sized").and_then(|value| value.as_bool()).unwrap_or(false);
            Some(SavedFolderEntry { name, path, bytes, kind, sized })
        })
        .collect()
}
