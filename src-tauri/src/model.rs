use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Mandatory,
    Keep,
    Optional,
    Clear,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mandatory => "mandatory",
            Self::Keep => "keep",
            Self::Optional => "optional",
            Self::Clear => "clear",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Folder,
    File,
    App,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub name: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFolderEntry {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub kind: EntryKind,
    pub sized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFolder {
    pub path: String,
    pub bytes: u64,
    pub limited: bool,
    pub complete: bool,
    pub entries: Vec<SavedFolderEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageChild {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub verdict: Verdict,
    pub summary: String,
    pub trashable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<EntryKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageItem {
    pub id: String,
    pub title: String,
    pub path: String,
    pub bytes: u64,
    pub verdict: Verdict,
    pub group: String,
    pub summary: String,
    pub detail: String,
    pub children: Vec<StorageChild>,
    pub trashable: bool,
    pub lift_from_parent: bool,
    pub shadow: bool,
    pub complete: bool,
    pub limited: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanEvent {
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<StorageItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limited: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
}

impl TrashResult {
    pub fn ok(bytes: Option<u64>) -> Self {
        Self { ok: true, error: None, bytes }
    }

    pub fn err(error: impl Into<String>) -> Self {
        Self { ok: false, error: Some(error.into()), bytes: None }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashBatchResult {
    pub trashed: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sizes: Option<std::collections::BTreeMap<String, u64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedScan {
    pub scanned_at: i64,
    pub limited: u32,
    pub items: Vec<StorageItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub kind: EntryKind,
    pub verdict: Verdict,
    pub summary: String,
    pub trashable: bool,
    pub measured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderListing {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub verdict: Verdict,
    pub summary: String,
    pub trashable: bool,
    pub entries: Vec<FolderEntry>,
    pub smaller_count: u32,
    pub smaller_bytes: u64,
    pub limited: bool,
    pub measuring: bool,
    pub token: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeUpdate {
    pub path: String,
    pub bytes: u64,
}

/// `entries` is null while sizes are still arriving, and the finished list when they are not.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderUpdate {
    pub path: String,
    pub token: u64,
    pub bytes: u64,
    pub sizes: Vec<SizeUpdate>,
    pub entries: Option<Vec<FolderEntry>>,
    pub smaller_count: u32,
    pub smaller_bytes: u64,
    pub measuring: bool,
    pub limited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIconSet {
    pub light: String,
    pub dark: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listing: Option<FolderListing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl FolderResult {
    pub fn ok(listing: FolderListing) -> Self {
        Self { ok: true, listing: Some(listing), error: None }
    }

    pub fn err(error: impl Into<String>) -> Self {
        Self { ok: false, listing: None, error: Some(error.into()) }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl AssistantResult {
    pub fn ok(notice: impl Into<String>) -> Self {
        Self { ok: true, notice: Some(notice.into()), error: None }
    }

    pub fn err(error: impl Into<String>) -> Self {
        Self { ok: false, notice: None, error: Some(error.into()) }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMeta {
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInfo {
    pub modified: i64,
    pub created: Option<i64>,
    pub opened: Option<i64>,
    pub items: Option<u64>,
    pub hidden: bool,
    pub link: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub bytes: u64,
    #[serde(skip)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub page_url: String,
    pub asset: Option<UpdateAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub received: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl UpdateResult {
    pub fn from(result: Result<(), String>) -> Self {
        match result {
            Ok(()) => Self { ok: true, error: None },
            Err(error) => Self { ok: false, error: Some(error) },
        }
    }
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub fn app_version() -> String {
    let pkg: serde_json::Value = serde_json::from_str(include_str!("../../package.json")).unwrap_or(serde_json::Value::Null);
    pkg.get("version").and_then(|value| value.as_str()).unwrap_or(env!("CARGO_PKG_VERSION")).to_string()
}
