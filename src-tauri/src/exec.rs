use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

pub struct Tracked {
    pub pid: u32,
    pub group: bool,
}

pub struct RunResult {
    pub stdout: String,
    pub timed_out: bool,
    pub code: Option<i32>,
}

impl RunResult {
    fn empty() -> Self {
        Self { stdout: String::new(), timed_out: false, code: None }
    }
}

pub fn kill_pid(pid: u32, group: bool) {
    if pid == 0 {
        return;
    }
    let pid = pid as i32;
    unsafe {
        if group {
            libc::kill(-pid, libc::SIGKILL);
        }
        libc::kill(pid, libc::SIGKILL);
    }
}

fn track(processes: &Mutex<Vec<Tracked>>, pid: u32) {
    if let Ok(mut list) = processes.lock() {
        list.push(Tracked { pid, group: false });
    }
}

fn untrack(processes: &Mutex<Vec<Tracked>>, pid: u32) {
    if let Ok(mut list) = processes.lock() {
        list.retain(|entry| entry.pid != pid);
    }
}

// stderr is drained too, so a chatty child never blocks on a full pipe.
fn pump(reader: impl Read + Send + 'static, sender: Option<mpsc::Sender<String>>) {
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let Some(sender) = sender.as_ref() else { continue };
                    if sender.send(String::from_utf8_lossy(&buffer[..count]).into_owned()).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });
}

fn collect(mut child: std::process::Child, receiver: Receiver<String>, timeout: Duration, current: impl Fn() -> bool) -> RunResult {
    let pid = child.id();
    let started = Instant::now();
    let mut stdout = String::new();
    let mut timed_out = false;
    let mut take = |text: String| {
        if stdout.len() < 8_000_000 {
            stdout.push_str(&text);
        }
    };
    loop {
        if !current() {
            kill_pid(pid, false);
            break;
        }
        if started.elapsed() > timeout {
            timed_out = true;
            kill_pid(pid, false);
            break;
        }
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(text) => take(text),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if child.try_wait().ok().flatten().is_some() {
                    while let Ok(text) = receiver.try_recv() {
                        take(text);
                    }
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    while let Ok(text) = receiver.recv_timeout(Duration::from_millis(20)) {
        take(text);
    }
    let status = child.wait().ok();
    RunResult { stdout, timed_out: timed_out && current(), code: status.and_then(|status| status.code()) }
}

pub fn run_command(program: &str, args: &[String], timeout: Duration, processes: &Mutex<Vec<Tracked>>, current: impl Fn() -> bool) -> RunResult {
    run_command_with(program, args, &[], false, timeout, processes, current)
}

/// Like `run_command`, with extra environment variables, and stderr kept in the output when `with_stderr` is set.
pub fn run_command_with(
    program: &str,
    args: &[String],
    envs: &[(&str, &str)],
    with_stderr: bool,
    timeout: Duration,
    processes: &Mutex<Vec<Tracked>>,
    current: impl Fn() -> bool,
) -> RunResult {
    if !current() {
        return RunResult::empty();
    }
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (key, value) in envs {
        command.env(key, value);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return RunResult { stdout: String::new(), timed_out: false, code: Some(1) },
    };
    let pid = child.id();
    track(processes, pid);
    let (sender, receiver) = mpsc::channel();
    if let Some(stderr) = child.stderr.take() {
        pump(stderr, with_stderr.then(|| sender.clone()));
    }
    if let Some(stdout) = child.stdout.take() {
        pump(stdout, Some(sender));
    }
    let result = collect(child, receiver, timeout, current);
    untrack(processes, pid);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_output_and_exit_code() {
        let processes = Mutex::new(Vec::new());
        let result = run_command("echo", &["stow".to_string()], Duration::from_secs(5), &processes, || true);
        assert_eq!(result.stdout.trim(), "stow");
        assert_eq!(result.code, Some(0));
        assert!(processes.lock().unwrap().is_empty());
    }
}
