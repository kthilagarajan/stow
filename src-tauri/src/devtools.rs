use std::collections::HashSet;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::disk::{browse_pool, Walk};
use crate::exec::{kill_pid, run_command_with, RunResult, Tracked};
use crate::paths;

/// A developer tool with its own cleanup command. The window only ever sends an `id`; the command is fixed here.
struct Tool {
    id: &'static str,
    name: &'static str,
    program: &'static str,
    clean: &'static [&'static str],
    summary: &'static str,
    detail: &'static str,
}

const TOOLS: &[Tool] = &[
    Tool {
        id: "docker",
        name: "Docker",
        program: "docker",
        clean: &["system", "prune", "--force"],
        summary: "Stopped containers, unused networks, dangling images and build cache.",
        detail: "Running containers, images a container uses, and volumes stay. Docker pulls or builds what it removed again when you need it.",
    },
    Tool {
        id: "npm",
        name: "npm",
        program: "npm",
        clean: &["cache", "clean", "--force"],
        summary: "Packages npm already downloaded.",
        detail: "Your projects and their node_modules stay. The next install downloads what it needs.",
    },
    Tool {
        id: "pnpm",
        name: "pnpm",
        program: "pnpm",
        clean: &["store", "prune"],
        summary: "Packages in the pnpm store that no project links to.",
        detail: "Packages a project still uses stay in the store.",
    },
    Tool {
        id: "yarn",
        name: "Yarn",
        program: "yarn",
        clean: &["cache", "clean"],
        summary: "Packages Yarn already downloaded.",
        detail: "Your projects stay. The next install downloads what it needs.",
    },
    Tool {
        id: "homebrew",
        name: "Homebrew",
        program: "brew",
        clean: &["cleanup"],
        summary: "Old versions of installed tools and stale downloads.",
        detail: "The current version of every tool stays.",
    },
    Tool {
        id: "pip",
        name: "pip",
        program: "pip3",
        clean: &["cache", "purge"],
        summary: "Python packages pip already downloaded.",
        detail: "Installed packages and virtual environments stay. The next install downloads what it needs.",
    },
    Tool {
        id: "go",
        name: "Go modules",
        program: "go",
        clean: &["clean", "-modcache"],
        summary: "Modules Go downloaded for builds.",
        detail: "Your code stays. The next build downloads the modules it needs again.",
    },
    Tool {
        id: "simulators",
        name: "Unavailable simulators",
        program: "xcrun",
        clean: &["simctl", "delete", "unavailable"],
        summary: "Simulators for iOS versions Xcode no longer has.",
        detail: "Only simulators Xcode can no longer run are removed, with anything saved inside them. Working simulators stay.",
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevTool {
    pub id: &'static str,
    pub name: &'static str,
    pub installed: bool,
    pub ready: bool,
    pub bytes: Option<u64>,
    /// `frees` when `bytes` is what the cleanup removes, `holds` when it is everything the tool keeps.
    pub estimate: &'static str,
    pub note: Option<String>,
    pub summary: &'static str,
    pub detail: &'static str,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevCleanResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub output: String,
    pub tool: Option<DevTool>,
}

const REPORT_TIMEOUT: Duration = Duration::from_secs(60);
const CLEAN_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const SHOWN_OUTPUT: usize = 6_000;

pub struct DevTools {
    processes: Mutex<Vec<Tracked>>,
    cleaning: Mutex<HashSet<&'static str>>,
}

impl DevTools {
    pub fn new() -> Self {
        Self { processes: Mutex::new(Vec::new()), cleaning: Mutex::new(HashSet::new()) }
    }

    pub fn stop(&self) {
        let list = self.processes.lock().unwrap_or_else(|poison| poison.into_inner());
        for entry in list.iter() {
            kill_pid(entry.pid, entry.group);
        }
    }

    pub fn known(id: &str) -> bool {
        TOOLS.iter().any(|tool| tool.id == id)
    }

    pub fn name(id: &str) -> Option<&'static str> {
        TOOLS.iter().find(|tool| tool.id == id).map(|tool| tool.name)
    }

    pub fn report_all(&self) -> Vec<DevTool> {
        std::thread::scope(|scope| {
            let handles: Vec<_> = TOOLS.iter().map(|tool| scope.spawn(move || self.report(tool))).collect();
            handles.into_iter().zip(TOOLS).map(|(handle, tool)| handle.join().unwrap_or_else(|_| blank(tool, None))).collect()
        })
    }

    pub fn clean(&self, id: &str) -> DevCleanResult {
        let Some(tool) = TOOLS.iter().find(|tool| tool.id == id) else {
            return DevCleanResult { ok: false, error: Some("Stow does not know that tool.".into()), output: String::new(), tool: None };
        };
        if !self.cleaning.lock().unwrap_or_else(|poison| poison.into_inner()).insert(tool.id) {
            return DevCleanResult { ok: false, error: Some(format!("{} is already cleaning up.", tool.name)), output: String::new(), tool: None };
        }
        let result = self.run_clean(tool);
        self.cleaning.lock().unwrap_or_else(|poison| poison.into_inner()).remove(tool.id);
        result
    }

    fn run_clean(&self, tool: &Tool) -> DevCleanResult {
        let Some(program) = locate(tool.program) else {
            return DevCleanResult { ok: false, error: Some(format!("{} is not installed.", tool.name)), output: String::new(), tool: Some(blank(tool, None)) };
        };
        let before = self.report(tool);
        if !before.ready {
            let error = before.note.clone().unwrap_or_else(|| format!("{} cannot clean up right now.", tool.name));
            return DevCleanResult { ok: false, error: Some(error), output: String::new(), tool: Some(before) };
        }
        let run = self.run(&program, tool.clean, CLEAN_TIMEOUT);
        let output = tail(&run.stdout);
        let after = self.report(tool);
        if run.timed_out {
            return DevCleanResult { ok: false, error: Some(format!("{} took too long and was stopped.", tool.name)), output, tool: Some(after) };
        }
        if run.code != Some(0) {
            return DevCleanResult { ok: false, error: Some(format!("{} stopped with an error.", tool.name)), output, tool: Some(after) };
        }
        DevCleanResult { ok: true, error: None, output, tool: Some(after) }
    }

    fn run(&self, program: &str, args: &[&str], timeout: Duration) -> RunResult {
        let args: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
        let envs = [("PATH", search_path()), ("HOMEBREW_NO_AUTO_UPDATE", "1"), ("HOMEBREW_NO_ENV_HINTS", "1"), ("NO_COLOR", "1")];
        run_command_with(program, &args, &envs, true, timeout, &self.processes, || true)
    }

    fn report(&self, tool: &Tool) -> DevTool {
        let Some(program) = locate(tool.program) else { return blank(tool, None) };
        let mut found = DevTool { installed: true, ready: true, ..blank(tool, None) };
        match tool.id {
            "docker" => {
                let run = self.run(&program, &["system", "df", "--format", "{{json .}}"], REPORT_TIMEOUT);
                if run.code != Some(0) {
                    found.ready = false;
                    found.note = Some("Docker is not running. Open Docker to see what it can clear.".into());
                } else {
                    found.bytes = Some(docker_reclaimable(&run.stdout));
                }
            }
            "homebrew" => {
                let run = self.run(&program, &["cleanup", "--dry-run"], REPORT_TIMEOUT);
                found.bytes = Some(if run.code == Some(0) { brew_frees(&run.stdout) } else { 0 });
            }
            "simulators" => {
                let run = self.run(&program, &["simctl", "list", "devices", "unavailable", "--json"], REPORT_TIMEOUT);
                let data = simulator_paths(&run.stdout);
                found.note = Some(match data.len() {
                    0 => "No unavailable simulators.".to_string(),
                    1 => "1 unavailable simulator.".to_string(),
                    count => format!("{count} unavailable simulators."),
                });
                found.ready = !data.is_empty();
                found.bytes = Some(data.iter().map(|path| measure(path)).sum());
            }
            _ => {
                let (args, estimate): (&[&str], &'static str) = match tool.id {
                    "npm" => (&["config", "get", "cache"], "frees"),
                    "pnpm" => (&["store", "path"], "holds"),
                    "yarn" => (&["cache", "dir"], "frees"),
                    "pip" => (&["cache", "dir"], "frees"),
                    _ => (&["env", "GOMODCACHE"], "frees"),
                };
                found.estimate = estimate;
                let run = self.run(&program, args, REPORT_TIMEOUT);
                let dir = last_line(&run.stdout);
                if run.code == Some(0) && paths::is_absolute(&dir) {
                    found.bytes = Some(measure(&dir));
                }
            }
        }
        found
    }
}

fn blank(tool: &Tool, note: Option<String>) -> DevTool {
    DevTool {
        id: tool.id,
        name: tool.name,
        installed: false,
        ready: false,
        bytes: None,
        estimate: "frees",
        note,
        summary: tool.summary,
        detail: tool.detail,
        command: std::iter::once(tool.program).chain(tool.clean.iter().copied()).collect::<Vec<_>>().join(" "),
    }
}

fn measure(path: &str) -> u64 {
    let stop = || false;
    let walk = Walk::new(&stop, Some(Instant::now() + Duration::from_secs(45)));
    browse_pool().install(|| walk.size(Path::new(path)))
}

fn tail(output: &str) -> String {
    let trimmed = output.trim();
    if trimmed.len() <= SHOWN_OUTPUT {
        return trimmed.to_string();
    }
    let mut start = trimmed.len() - SHOWN_OUTPUT;
    while !trimmed.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &trimmed[start..])
}

fn last_line(output: &str) -> String {
    output.lines().map(str::trim).filter(|line| !line.is_empty()).last().unwrap_or("").to_string()
}

/// A window opened from Finder gets a bare PATH, so look where installers and version managers put tools,
/// and in the PATH the person's login shell sets up.
fn search_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let home = paths::home_dir();
        let mut dirs: Vec<String> = login_shell_path().map(|path| path.split(':').map(str::to_string).collect()).unwrap_or_default();
        for dir in [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/local/go/bin",
            "/Applications/Docker.app/Contents/Resources/bin",
        ] {
            dirs.push(dir.to_string());
        }
        for dir in [".docker/bin", ".volta/bin", "Library/pnpm", ".local/bin", "go/bin", ".yarn/bin"] {
            dirs.push(paths::join(&[&home, dir]));
        }
        dirs.extend(nvm_bins(&home));
        for dir in ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            dirs.push(dir.to_string());
        }
        let mut seen = HashSet::new();
        dirs.retain(|dir| !dir.is_empty() && seen.insert(dir.clone()));
        dirs.join(":")
    })
}

fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok().filter(|shell| shell.starts_with('/'))?;
    let processes = Mutex::new(Vec::new());
    let marker = "__STOW_PATH__";
    let script = format!("printf '{marker}%s{marker}' \"$PATH\"");
    let run = run_command_with(&shell, &["-ilc".to_string(), script], &[], false, Duration::from_secs(5), &processes, || true);
    let start = run.stdout.find(marker)? + marker.len();
    let end = start + run.stdout[start..].find(marker)?;
    Some(run.stdout[start..end].to_string())
}

fn nvm_bins(home: &str) -> Vec<String> {
    let root = paths::join(&[home, ".nvm/versions/node"]);
    let Ok(entries) = std::fs::read_dir(&root) else { return Vec::new() };
    let mut versions: Vec<String> = entries.filter_map(|entry| entry.ok()).map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
    versions.sort_by(|a, b| {
        if crate::version::is_newer(a, b) {
            std::cmp::Ordering::Less
        } else if crate::version::is_newer(b, a) {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
    versions.into_iter().map(|version| paths::join(&[&root, &version, "bin"])).collect()
}

fn locate(program: &str) -> Option<String> {
    use std::os::unix::fs::PermissionsExt;
    let found = search_path().split(':').map(|dir| paths::join(&[dir, program])).find(|candidate| {
        std::fs::metadata(candidate).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
    })?;
    // /usr/bin/pip3 and /usr/bin/xcrun only ask to install the command line tools when those are missing.
    if found.starts_with("/usr/bin/") && !developer_tools_installed() {
        return None;
    }
    Some(found)
}

fn developer_tools_installed() -> bool {
    static INSTALLED: OnceLock<bool> = OnceLock::new();
    *INSTALLED.get_or_init(|| {
        std::process::Command::new("/usr/bin/xcode-select")
            .arg("-p")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    })
}

/// Docker prints sizes in decimal units, like `1.2GB (40%)`.
fn docker_reclaimable(output: &str) -> u64 {
    output
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|row| row.get("Reclaimable").and_then(|value| value.as_str()).and_then(|text| parse_size(text.split_whitespace().next()?, 1000.0)))
        .sum()
}

/// Homebrew ends a dry run with "This operation would free approximately 1.2GB of disk space."
fn brew_frees(output: &str) -> u64 {
    output
        .lines()
        .find_map(|line| {
            let rest = line.split("approximately ").nth(1)?;
            parse_size(rest.split_whitespace().next()?, 1024.0)
        })
        .unwrap_or(0)
}

fn parse_size(text: &str, base: f64) -> Option<u64> {
    let split = text.find(|c: char| !(c.is_ascii_digit() || c == '.'))?;
    let (number, unit) = text.split_at(split);
    let number: f64 = number.parse().ok()?;
    let power = match unit.to_ascii_uppercase().trim_end_matches("IB").trim_end_matches('B') {
        "" => 0,
        "K" => 1,
        "M" => 2,
        "G" => 3,
        "T" => 4,
        _ => return None,
    };
    Some((number * base.powi(power)) as u64)
}

fn simulator_paths(output: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(output) else { return Vec::new() };
    let Some(runtimes) = value.get("devices").and_then(|devices| devices.as_object()) else { return Vec::new() };
    runtimes
        .values()
        .filter_map(|devices| devices.as_array())
        .flatten()
        .filter_map(|device| device.get("dataPath").and_then(|path| path.as_str()))
        .map(|path| paths::dirname(path))
        .collect()
}

pub fn demo_tools() -> Vec<DevTool> {
    let sizes: [(&str, Option<u64>, Option<&str>); 8] = [
        ("docker", Some(18_400_000_000), None),
        ("npm", Some(2_300_000_000), None),
        ("pnpm", Some(6_100_000_000), None),
        ("yarn", None, None),
        ("homebrew", Some(1_200_000_000), None),
        ("pip", Some(640_000_000), None),
        ("go", None, None),
        ("simulators", Some(4_800_000_000), Some("3 unavailable simulators.")),
    ];
    TOOLS
        .iter()
        .zip(sizes)
        .map(|(tool, (_, bytes, note))| DevTool {
            installed: bytes.is_some(),
            ready: bytes.is_some(),
            bytes,
            estimate: if tool.id == "pnpm" { "holds" } else { "frees" },
            note: note.map(str::to_string),
            ..blank(tool, None)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_docker_reclaimable_space() {
        let output = r#"{"Type":"Images","Reclaimable":"1.5GB (40%)"}
{"Type":"Containers","Reclaimable":"0B (0%)"}
{"Type":"Build Cache","Reclaimable":"250MB"}"#;
        assert_eq!(docker_reclaimable(output), 1_750_000_000);
    }

    #[test]
    fn reads_what_homebrew_would_free() {
        let output = "Would remove: /Users/alex/Library/Caches/Homebrew/wget--1.0 (1.2MB)\n==> This operation would free approximately 2KB of disk space.";
        assert_eq!(brew_frees(output), 2048);
        assert_eq!(brew_frees("nothing"), 0);
    }

    #[test]
    fn parses_sizes() {
        assert_eq!(parse_size("12.5kB", 1000.0), Some(12_500));
        assert_eq!(parse_size("3MiB", 1024.0), Some(3 * 1024 * 1024));
        assert_eq!(parse_size("0B", 1000.0), Some(0));
        assert_eq!(parse_size("lots", 1000.0), None);
    }

    #[test]
    fn finds_unavailable_simulator_folders() {
        let output = r#"{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-16-0":[{"dataPath":"/Users/alex/Library/Developer/CoreSimulator/Devices/ABC/data","name":"iPhone 14"}]}}"#;
        assert_eq!(simulator_paths(output), vec!["/Users/alex/Library/Developer/CoreSimulator/Devices/ABC".to_string()]);
    }

    #[test]
    fn only_known_tools_have_commands() {
        assert!(DevTools::known("docker"));
        assert!(!DevTools::known("rm"));
        assert_eq!(blank(&TOOLS[0], None).command, "docker system prune --force");
    }
}

