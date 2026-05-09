//! PipelineKit desktop entry point.
//!
//! On startup the desktop shell spawns the bundled Node sidecar (a single
//! self-contained `pipelinekit-sidecar.cjs` shipped via `bundle.resources`).
//! In dev mode — when a developer is already running `pnpm sidecar dev` and
//! `127.0.0.1:4317` is occupied — the spawn is skipped so the running
//! sidecar stays in charge. The child is killed when the last window closes.

use std::fs::OpenOptions;
use std::io::{Read as _, Write as _};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod menu;

const SIDECAR_PORT: u16 = 4317;
const SIDECAR_RESOURCE: &str = "resources/pipelinekit-sidecar.cjs";

/// Tauri-managed state holding the running sidecar child, if any.
struct SidecarHandle(Mutex<Option<CommandChild>>);

fn is_pipelinekit_sidecar_listening(port: u16) -> bool {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(150)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok()
        && response.contains("\"service\"")
        && response.contains("pipelinekit-sidecar")
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
    if is_pipelinekit_sidecar_listening(SIDECAR_PORT) {
        eprintln!(
            "[pipelinekit] PipelineKit sidecar already listening on :{SIDECAR_PORT}, skipping spawn"
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

/// Applies platform-native window effects to the main window.
///
/// macOS gets `NSVisualEffectMaterial::Sidebar` so the title-bar Overlay
/// area picks up a frosted-glass look. Failures are non-fatal — if the
/// underlying API call fails we just log and continue with the default
/// chrome.
#[allow(unused_variables)]
fn apply_window_effects(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        if let Err(err) = apply_vibrancy(
            &window,
            NSVisualEffectMaterial::Sidebar,
            Some(NSVisualEffectState::Active),
            None,
        ) {
            eprintln!("[pipelinekit] failed to apply macOS vibrancy: {err:?}");
        }
    }

    #[cfg(target_os = "windows")]
    {
        // false = light mode. Mica is Windows 11+ only; on older
        // Windows versions this returns UnsupportedPlatform and we
        // fall back to the default solid title bar.
        if let Err(err) = window_vibrancy::apply_mica(&window, Some(false)) {
            eprintln!("[pipelinekit] failed to apply Windows Mica blur: {err:?}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .on_menu_event(menu::handle_menu_event);

    // On macOS, clicking the red traffic light should hide the window
    // (not quit the app), matching native AppKit conventions. Cmd+Q
    // still quits because PredefinedMenuItem::quit handles it natively.
    #[cfg(target_os = "macos")]
    let builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    });

    builder
        .setup(|app| {
            if let Err(err) = menu::build_and_install(&app.handle()) {
                eprintln!("[pipelinekit] failed to install application menu: {err}");
            }
            apply_window_effects(&app.handle());
            if let Err(err) = spawn_sidecar(&app.handle()) {
                eprintln!("[pipelinekit] sidecar spawn failed: {err}");
                let log_path = log_dir().join("sidecar.log");
                append_log(&log_path, &format!("[fatal] {err}"));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build PipelineKit desktop app")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } => {
                kill_sidecar(app);
            }
            // macOS dock-click reopen: when the user activates the app
            // via the dock and we have no visible windows (because the
            // close button hid them), bring the main window back.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { has_visible_windows, .. } if !has_visible_windows => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        });
}
