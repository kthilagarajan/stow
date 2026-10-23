/// POSIX path helpers matching Node's `path` for the cases Stow uses.

pub fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/Users/alex".to_string())
}

pub fn is_absolute(path: &str) -> bool {
    path.starts_with('/')
}

pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if absolute {
                parts.pop();
            } else if parts.last().copied() == Some("..") || parts.is_empty() {
                parts.push("..");
            } else {
                parts.pop();
            }
            continue;
        }
        parts.push(part);
    }
    if absolute {
        if parts.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", parts.join("/"))
        }
    } else if parts.is_empty() {
        ".".to_string()
    } else {
        parts.join("/")
    }
}

pub fn trim_trailing_slash(path: &str) -> String {
    let normalized = normalize(path);
    if normalized == "/" {
        return normalized;
    }
    normalized.trim_end_matches('/').to_string()
}

pub fn join(parts: &[&str]) -> String {
    let mut combined = String::new();
    for part in parts {
        if part.is_empty() {
            continue;
        }
        if combined.is_empty() {
            combined.push_str(part);
        } else {
            if !combined.ends_with('/') {
                combined.push('/');
            }
            combined.push_str(part.trim_start_matches('/'));
        }
    }
    if combined.is_empty() {
        ".".to_string()
    } else {
        normalize(&combined)
    }
}

pub fn basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.rsplit('/').next().unwrap_or("").to_string()
}

pub fn dirname(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    match trimmed.rfind('/') {
        None => ".".to_string(),
        Some(0) => "/".to_string(),
        Some(index) => trimmed[..index].to_string(),
    }
}

pub fn resolve(path: &str) -> String {
    if is_absolute(path) {
        normalize(path)
    } else {
        let cwd = std::env::current_dir().map(|dir| dir.to_string_lossy().to_string()).unwrap_or_else(|_| "/".to_string());
        normalize(&format!("{cwd}/{path}"))
    }
}

#[allow(dead_code)]
pub fn starts_inside(path: &str, root: &str) -> bool {
    path == root || path.starts_with(&format!("{root}/"))
}

/// Case-insensitive natural order, close to `localeCompare` with `numeric: true`.
pub fn cmp_name(a: &str, b: &str) -> std::cmp::Ordering {
    let left: Vec<char> = a.chars().flat_map(|ch| ch.to_lowercase()).collect();
    let right: Vec<char> = b.chars().flat_map(|ch| ch.to_lowercase()).collect();
    let mut i = 0;
    let mut j = 0;
    while i < left.len() && j < right.len() {
        if left[i].is_ascii_digit() && right[j].is_ascii_digit() {
            let i_start = i;
            let j_start = j;
            while i < left.len() && left[i].is_ascii_digit() {
                i += 1;
            }
            while j < right.len() && right[j].is_ascii_digit() {
                j += 1;
            }
            let left_digits: String = left[i_start..i].iter().collect();
            let right_digits: String = right[j_start..j].iter().collect();
            let left_trim = left_digits.trim_start_matches('0');
            let right_trim = right_digits.trim_start_matches('0');
            let left_trim = if left_trim.is_empty() { "0" } else { left_trim };
            let right_trim = if right_trim.is_empty() { "0" } else { right_trim };
            let order = left_trim.len().cmp(&right_trim.len()).then_with(|| left_trim.cmp(right_trim));
            if order != std::cmp::Ordering::Equal {
                return order;
            }
        } else {
            let order = left[i].cmp(&right[j]);
            if order != std::cmp::Ordering::Equal {
                return order;
            }
            i += 1;
            j += 1;
        }
    }
    left.len().cmp(&right.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_dot_segments() {
        assert_eq!(normalize("/Users/alex/"), "/Users/alex");
        assert_eq!(normalize("/Users//alex/../alex"), "/Users/alex");
        assert_eq!(normalize("/"), "/");
        assert_eq!(basename("/Users/alex/"), "alex");
        assert_eq!(basename("/"), "");
        assert_eq!(dirname("/Users/alex/foo"), "/Users/alex");
        assert_eq!(dirname("/Users"), "/");
        assert_eq!(join(&["/Users/alex", "Library", "Caches"]), "/Users/alex/Library/Caches");
    }
}
