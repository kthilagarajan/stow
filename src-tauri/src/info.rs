use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::model::ItemInfo;
use crate::paths;

fn time_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as i64).unwrap_or(0)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut year = year;
    let month = month as i32;
    let day = day as i32;
    year -= i32::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = (year - era * 400) as u32;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy as u32;
    Some(era as i64 * 146097 + doe as i64 - 719468)
}

fn parse_mdls_date(raw: &str) -> Option<i64> {
    let text = raw.trim();
    if text.is_empty() || text == "(null)" || text.len() < 19 {
        return None;
    }
    let year: i32 = text.get(0..4)?.parse().ok()?;
    let month: u32 = text.get(5..7)?.parse().ok()?;
    let day: u32 = text.get(8..10)?.parse().ok()?;
    let hour: u32 = text.get(11..13)?.parse().ok()?;
    let minute: u32 = text.get(14..16)?.parse().ok()?;
    let second: u32 = text.get(17..19)?.parse().ok()?;
    let rest = text.get(19..)?.trim();
    let (sign, zone) = rest.strip_prefix('+').map(|zone| (1_i32, zone)).or_else(|| rest.strip_prefix('-').map(|zone| (-1, zone)))?;
    let zone_hour: i32 = zone.get(0..2)?.parse().ok()?;
    let zone_minute: i32 = zone.get(2..4).unwrap_or("00").parse().ok()?;
    let offset = sign * (zone_hour * 3600 + zone_minute * 60);
    let days = days_from_civil(year, month, day)?;
    let secs = days * 86_400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64 - offset as i64;
    Some(secs * 1000)
}

fn last_opened(file_path: &str) -> Option<i64> {
    let child = Command::new("mdls")
        .args(["-raw", "-name", "kMDItemLastUsedDate", file_path])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let finished = wait_timeout(child, Duration::from_secs(3))?;
    if !finished.status.success() {
        return None;
    }
    parse_mdls_date(&String::from_utf8_lossy(&finished.stdout))
}

fn wait_timeout(child: std::process::Child, timeout: Duration) -> Option<std::process::Output> {
    let pid = child.id();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(child.wait_with_output());
    });
    match receiver.recv_timeout(timeout) {
        Ok(Ok(output)) => Some(output),
        _ => {
            crate::exec::kill_pid(pid, false);
            None
        }
    }
}

pub fn item_info(file_path: &str) -> Option<ItemInfo> {
    if file_path.is_empty() || !paths::is_absolute(file_path) || file_path.contains('\0') {
        return None;
    }
    let meta = std::fs::symlink_metadata(file_path).ok()?;
    let directory = meta.file_type().is_dir();
    let items = if directory {
        std::fs::read_dir(file_path).ok().map(|entries| entries.count() as u64)
    } else {
        None
    };
    let created = meta.created().ok().map(time_ms).filter(|value| *value > 0);
    Some(ItemInfo {
        modified: meta.modified().ok().map(time_ms).unwrap_or(0),
        created,
        opened: last_opened(file_path),
        items,
        hidden: paths::basename(file_path).starts_with('.'),
        link: meta.file_type().is_symlink(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_spotlight_dates() {
        assert_eq!(parse_mdls_date("1970-01-01 00:00:00 +0000"), Some(0));
        assert_eq!(parse_mdls_date("(null)"), None);
    }
}
