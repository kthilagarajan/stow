use std::collections::HashSet;
use std::fs::{self, Metadata};
use std::io::ErrorKind;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use rayon::prelude::*;
use rayon::{ThreadPool, ThreadPoolBuilder};

// Walking is mostly waiting on the file system, so both pools run more threads than there are cores.
// Browsing gets its own pool so a folder the person opened is never queued behind the full scan.
pub fn browse_pool() -> &'static ThreadPool {
    static POOL: OnceLock<ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| build_pool("stow-browse", (cores() * 2).max(8)))
}

pub fn scan_pool() -> &'static ThreadPool {
    static POOL: OnceLock<ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| build_pool("stow-scan", cores().max(4)))
}

fn cores() -> usize {
    std::thread::available_parallelism().map(|count| count.get()).unwrap_or(4)
}

fn build_pool(name: &'static str, threads: usize) -> ThreadPool {
    ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(move |index| format!("{name}-{index}"))
        .build()
        .expect("Stow could not start its disk threads")
}

pub struct Tree {
    pub total: u64,
    pub dirs: Vec<(String, u64)>,
}

/// Measures like `du -k`: allocated blocks, each hard link once, symlinks not followed, one volume only.
pub struct Walk<'a> {
    stop: &'a (dyn Fn() -> bool + Sync),
    deadline: Option<Instant>,
    linked: Mutex<HashSet<(u64, u64)>>,
    denied: AtomicBool,
    timed_out: AtomicBool,
}

impl<'a> Walk<'a> {
    pub fn new(stop: &'a (dyn Fn() -> bool + Sync), deadline: Option<Instant>) -> Self {
        Self { stop, deadline, linked: Mutex::new(HashSet::new()), denied: AtomicBool::new(false), timed_out: AtomicBool::new(false) }
    }

    pub fn denied(&self) -> bool {
        self.denied.load(Ordering::Relaxed)
    }

    pub fn timed_out(&self) -> bool {
        self.timed_out.load(Ordering::Relaxed)
    }

    pub fn halted(&self) -> bool {
        if (self.stop)() {
            return true;
        }
        if self.deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            self.timed_out.store(true, Ordering::Relaxed);
            return true;
        }
        false
    }

    /// Bytes on disk for a file or a whole folder.
    pub fn size(&self, path: &Path) -> u64 {
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_dir() => self.blocks(&meta) + self.inside(path, meta.dev()),
            Ok(meta) => self.blocks(&meta),
            Err(error) => {
                self.note(&error);
                0
            }
        }
    }

    /// The folder's total and the size of each folder directly inside it, like `du -d 1`.
    pub fn tree(&self, path: &Path) -> Tree {
        let Ok(meta) = fs::symlink_metadata(path) else { return Tree { total: 0, dirs: Vec::new() } };
        let (files, dirs) = self.read(path, meta.dev());
        let dirs: Vec<(String, u64)> = dirs
            .into_par_iter()
            .map(|(child, own)| {
                let bytes = own + self.inside(Path::new(&child), meta.dev());
                (child, bytes)
            })
            .collect();
        let total = self.blocks(&meta) + files + dirs.iter().map(|(_, bytes)| bytes).sum::<u64>();
        Tree { total, dirs }
    }

    fn inside(&self, path: &Path, device: u64) -> u64 {
        if self.halted() {
            return 0;
        }
        let (files, dirs) = self.read(path, device);
        files + dirs.into_par_iter().map(|(child, own)| own + self.inside(Path::new(&child), device)).sum::<u64>()
    }

    // Returns the bytes of everything that is not a folder, and each folder with its own blocks.
    fn read(&self, path: &Path, device: u64) -> (u64, Vec<(String, u64)>) {
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(error) => {
                self.note(&error);
                return (0, Vec::new());
            }
        };
        let mut files = 0;
        let mut dirs = Vec::new();
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                if meta.dev() == device {
                    dirs.push((entry.path().to_string_lossy().into_owned(), self.blocks(&meta)));
                }
            } else {
                files += self.blocks(&meta);
            }
        }
        (files, dirs)
    }

    fn blocks(&self, meta: &Metadata) -> u64 {
        if meta.nlink() > 1 && !meta.is_dir() {
            let mut linked = self.linked.lock().unwrap_or_else(|poison| poison.into_inner());
            if !linked.insert((meta.dev(), meta.ino())) {
                return 0;
            }
        }
        meta.blocks().saturating_mul(512)
    }

    fn note(&self, error: &std::io::Error) {
        if error.kind() == ErrorKind::PermissionDenied {
            self.denied.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("stow-disk-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("inner/deeper")).unwrap();
        fs::write(dir.join("top.bin"), vec![1_u8; 64 * 1024]).unwrap();
        fs::write(dir.join("inner/deeper/data.bin"), vec![2_u8; 128 * 1024]).unwrap();
        dir
    }

    #[test]
    fn counts_nested_files_and_lists_folders_one_level_down() {
        let dir = scratch("tree");
        let never = || false;
        let walk = Walk::new(&never, None);
        let tree = walk.tree(&dir);
        assert_eq!(tree.dirs.len(), 1);
        assert!(tree.dirs[0].1 >= 128 * 1024);
        assert!(tree.total >= tree.dirs[0].1 + 64 * 1024);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn counts_a_hard_link_once() {
        let dir = scratch("links");
        fs::hard_link(dir.join("top.bin"), dir.join("again.bin")).unwrap();
        let never = || false;
        let once = Walk::new(&never, None).size(&dir);
        fs::remove_file(dir.join("again.bin")).unwrap();
        let without = Walk::new(&never, None).size(&dir);
        assert_eq!(once, without);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stops_when_asked() {
        let dir = scratch("stop");
        let always = || true;
        let walk = Walk::new(&always, None);
        assert!(walk.size(&dir) < 128 * 1024);
        let _ = fs::remove_dir_all(&dir);
    }
}
