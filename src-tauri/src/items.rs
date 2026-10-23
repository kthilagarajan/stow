use crate::model::StorageItem;

pub fn freed_bytes(items: &[StorageItem], target: &str) -> u64 {
    for item in items {
        if item.path == target {
            return item.bytes;
        }
        if let Some(child) = item.children.iter().find(|entry| entry.path == target) {
            return child.bytes;
        }
    }
    0
}

pub fn is_trash_path(file_path: &str) -> bool {
    file_path == "/.Trash" || file_path.ends_with("/.Trash") || file_path.contains("/.Trash/")
}

pub fn clear_trash(items: Vec<StorageItem>) -> Vec<StorageItem> {
    items
        .into_iter()
        .filter_map(|item| {
            if item.shadow && is_trash_path(&item.path) {
                return None;
            }
            if item.id == "trash" {
                let mut item = item;
                item.bytes = 0;
                item.children.clear();
                item.complete = true;
                return Some(item);
            }
            Some(item)
        })
        .collect()
}

pub fn apply_trash(items: Vec<StorageItem>, target: &str, known_bytes: u64) -> Vec<StorageItem> {
    let bytes = {
        let freed = freed_bytes(&items, target);
        if freed == 0 { known_bytes } else { freed }
    };
    items
        .into_iter()
        .filter_map(|mut item| {
            if item.path == target {
                return None;
            }
            if item.children.iter().any(|entry| entry.path == target) {
                let child_bytes = item.children.iter().find(|entry| entry.path == target).map(|entry| entry.bytes).unwrap_or(0);
                item.children.retain(|entry| entry.path != target);
                if item.id == "node-modules" && item.children.is_empty() {
                    return None;
                }
                item.bytes = item.bytes.saturating_sub(child_bytes);
                return Some(item);
            }
            if !item.shadow && !item.path.is_empty() && target.starts_with(&format!("{}/", item.path)) {
                for entry in &mut item.children {
                    if target.starts_with(&format!("{}/", entry.path)) {
                        entry.bytes = entry.bytes.saturating_sub(bytes);
                    }
                }
                item.bytes = item.bytes.saturating_sub(bytes);
            }
            Some(item)
        })
        .collect()
}

pub fn add_to_trash(mut items: Vec<StorageItem>, bytes: u64) -> Vec<StorageItem> {
    if bytes == 0 {
        return items;
    }
    for item in &mut items {
        if item.id == "trash" {
            item.bytes = item.bytes.saturating_add(bytes);
        }
    }
    items
}
