//! PipelineKit desktop entry point.
//!
//! On startup the desktop shell spawns the bundled Node sidecar (a single
//! self-contained `pipelinekit-sidecar.cjs` shipped via `bundle.resources`).
//! In dev mode — when a developer is already running `pnpm sidecar dev` and
//! `127.0.0.1:4317` is occupied — the spawn is skipped so the running
//! sidecar stays in charge. The child is killed when the last window closes.

use std::fs::OpenOptions;
use std::io::Write as _;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const SIDECAR_PORT: u16 = 4317;
const SIDECAR_RESOURCE: &str = "resources/pipelinekit-sidecar.cjs";

/// Tauri-managed state holding the running sidecar child, if any.
struct SidecarHandle(Mutex<Option<CommandChild>>);

fn is_port_in_use(port: u16) -> bool {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok()
}

fn log_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pipelinekit")
}

fn append_log(path: &PathBuf, line: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
    if is_port_in_use(SIDECAR_PORT) {
        eprintln!(
            "[pipelinekit] sidecar already listening on :{SIDECAR_PORT}, skipping spawn"
        );
        return Ok(());
    }

    let resource_raw = app
        .path()
        .resolve(SIDECAR_RESOURCE, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("failed to resolve sidecar resource: {e}"))?;

    // On Windows, Tauri's BaseDirectory::Resource returns an extended-length
    // path with the `\\?\` prefix (e.g. `\\?\C:\Users\...`). Node v22+
    // mishandles this when it's the main script argument and crashes with
    // `EISDIR: illegal operation on a directory, lstat 'C:'`. dunce::simplified
    // strips the prefix when safe (path < 260 chars and no UNC weirdness).
    let resource: PathBuf = dunce::simplified(&resource_raw).to_path_buf();

    if !resource.exists() {
        let msg = format!(
            "sidecar bundle missing at {} — run `pnpm -w prebuild:desktop` before `tauri build`",
            resource.display()
        );
        eprintln!("[pipelinekit] {msg}");
        return Err(msg);
    }

    let log_root = log_dir();
    if let Err(e) = std::fs::create_dir_all(&log_root) {
        eprintln!(
            "[pipelinekit] could not create log dir {}: {e}",
            log_root.display()
        );
    }
    let log_path = log_root.join("sidecar.log");
    append_log(
        &log_path,
        &format!(
            "--- pipelinekit sidecar starting (resource: {}) ---",
            resource.display()
        ),
    );

    let resource_str = resource
        .to_str()
        .ok_or_else(|| "sidecar resource path is not valid UTF-8".to_string())?
        .to_string();

    let cmd = app.shell().command("node").args([resource_str]);
    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar `node` process: {e}"))?;

    app.manage(SidecarHandle(Mutex::new(Some(child))));

    // Pump stdout/stderr from the child into ~/.pipelinekit/sidecar.log so we
    // can debug production crashes after the fact. Fire-and-forget; if the
    // file can't be opened we silently drop output.
    let log_path_for_task = log_path.clone();
    tauri::async_runtime::spawn(async move {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path_for_task)
            .ok();
        while let Some(event) = rx.recv().await {
            let line: Option<Vec<u8>> = match event {
                CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => Some(b),
                CommandEvent::Error(msg) => Some(format!("[error] {msg}").into_bytes()),
                CommandEvent::Terminated(payload) => {
                    Some(format!("[exit] sidecar terminated: {payload:?}").into_bytes())
                }
                _ => None,
            };
            if let (Some(file), Some(line)) = (file.as_mut(), line) {
                let _ = file.write_all(&line);
                if !line.ends_with(b"\n") {
                    let _ = file.write_all(b"\n");
                }
            }
        }
    });

    Ok(())
}

fn kill_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarHandle>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if let Err(err) = spawn_sidecar(&app.handle()) {
                eprintln!("[pipelinekit] sidecar spawn failed: {err}");
                let log_path = log_dir().join("sidecar.log");
                append_log(&log_path, &format!("[fatal] {err}"));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build PipelineKit desktop app")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                kill_sidecar(app);
            }
        });
}
