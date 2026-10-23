use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::model::now_ms;

/// One piece of background work the window can list. `kind` is a code; the window chooses the wording.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityTask {
    pub id: u64,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    pub started_at: i64,
}

pub struct Activity {
    app: AppHandle,
    tasks: Mutex<BTreeMap<u64, ActivityTask>>,
    next: AtomicU64,
}

impl Activity {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self { app, tasks: Mutex::new(BTreeMap::new()), next: AtomicU64::new(1) })
    }

    pub fn begin(self: &Arc<Self>, kind: &'static str, target: Option<String>) -> Busy {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.lock().insert(id, ActivityTask { id, kind, target, done: None, total: None, started_at: now_ms() });
        self.publish();
        Busy { activity: self.clone(), id }
    }

    pub fn list(&self) -> Vec<ActivityTask> {
        self.lock().values().cloned().collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<u64, ActivityTask>> {
        self.tasks.lock().unwrap_or_else(|poison| poison.into_inner())
    }

    fn publish(&self) {
        let list = self.list();
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.emit("activity:update", &list);
        }
    }
}

/// Listed while it is alive; dropping it takes the task off the list.
pub struct Busy {
    activity: Arc<Activity>,
    id: u64,
}

impl Busy {
    pub fn progress(&self, target: Option<String>, done: u32, total: u32) {
        {
            let mut tasks = self.activity.lock();
            let Some(task) = tasks.get_mut(&self.id) else { return };
            if task.done == Some(done) && task.total == Some(total) && (target.is_none() || task.target == target) {
                return;
            }
            if target.is_some() {
                task.target = target;
            }
            task.done = Some(done);
            task.total = Some(total);
        }
        self.activity.publish();
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        self.activity.lock().remove(&self.id);
        self.activity.publish();
    }
}
