//! Native menu bar for the PipelineKit desktop shell.
//!
//! Tauri 2 lets us define a single `Menu` and attach it to the app on setup.
//! On macOS it becomes the global app menu (top of screen); on Windows /
//! Linux it renders as a per-window menu bar at the top of the main window.
//!
//! Most items are app-specific and emit IPC events of the form
//! `menu:<id>` for the React frontend to subscribe to via
//! `@tauri-apps/api/event`. Native operations (Quit, Hide, Cut/Copy/Paste,
//! Toggle Fullscreen, Minimize, etc.) use Tauri's `PredefinedMenuItem` so
//! the OS handles them automatically.
//!
//! IDs that the frontend listens for:
//!   menu:settings, menu:new-project, menu:import-project,
//!   menu:export-project, menu:run-pipeline, menu:cancel-run, menu:blender,
//!   menu:logs, menu:docs, menu:issues, menu:check-updates

use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

const DOCS_URL: &str = "https://github.com/pradhankukiran/pipeline-kit#readme";
const ISSUES_URL: &str = "https://github.com/pradhankukiran/pipeline-kit/issues";

/// Build the application menu and install it on the Tauri app handle.
///
/// Called from the Tauri builder's `setup` callback. The returned menu is
/// retained by the app handle, so we don't need to keep the value alive
/// here; we just hand it off via `app.set_menu(...)`.
pub fn build_and_install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    app.set_menu(menu)?;
    Ok(())
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg = app.package_info();

    // ---- App submenu (macOS only top-level; on other platforms the
    // Settings/Quit items are folded into File). ----
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some(pkg.name.clone()))
        .version(Some(pkg.version.to_string()))
        .copyright(Some("Copyright © 2026 Kiran Kumar Pradhan".to_string()))
        .website(Some("https://github.com/pradhankukiran/pipeline-kit".to_string()))
        .website_label(Some("Project home".to_string()))
        .build();

    let about_item =
        PredefinedMenuItem::about(app, Some("About PipelineKit"), Some(about_metadata))?;
    let settings_item = MenuItemBuilder::with_id("menu:settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let separator = || PredefinedMenuItem::separator(app);
    let services_item = PredefinedMenuItem::services(app, None)?;
    let hide_item = PredefinedMenuItem::hide(app, None)?;
    let hide_others_item = PredefinedMenuItem::hide_others(app, None)?;
    let show_all_item = PredefinedMenuItem::show_all(app, None)?;
    let quit_item = PredefinedMenuItem::quit(app, None)?;

    // ---- File submenu ----
    let new_project_item = MenuItemBuilder::with_id("menu:new-project", "New Project")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let import_project_item = MenuItemBuilder::with_id("menu:import-project", "Import Project…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let export_project_item = MenuItemBuilder::with_id(
        "menu:export-project",
        "Export Current Project…",
    )
    .accelerator("CmdOrCtrl+Shift+E")
    .build(app)?;
    let close_window_item = PredefinedMenuItem::close_window(app, None)?;

    // ---- Edit submenu (uses predefined items so native handlers fire) ----
    let undo_item = PredefinedMenuItem::undo(app, None)?;
    let redo_item = PredefinedMenuItem::redo(app, None)?;
    let cut_item = PredefinedMenuItem::cut(app, None)?;
    let copy_item = PredefinedMenuItem::copy(app, None)?;
    let paste_item = PredefinedMenuItem::paste(app, None)?;
    let select_all_item = PredefinedMenuItem::select_all(app, None)?;

    // ---- Run submenu ----
    let run_pipeline_item = MenuItemBuilder::with_id("menu:run-pipeline", "Run Pipeline")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let cancel_run_item = MenuItemBuilder::with_id("menu:cancel-run", "Cancel Current Run")
        .accelerator("CmdOrCtrl+.")
        .build(app)?;
    let blender_item = MenuItemBuilder::with_id("menu:blender", "Open Blender Page")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;

    // ---- View submenu ----
    // Toggle Fullscreen: macOS uses Ctrl+Cmd+F (Tauri's predefined item maps
    // to that natively); on Windows/Linux we pair F11 with a custom
    // app-emitted event so the frontend can request fullscreen via the
    // Tauri webview window API. We use the predefined item on macOS where
    // it's supported, and a custom item with F11 on other platforms.
    #[cfg(target_os = "macos")]
    let fullscreen_item: Box<dyn tauri::menu::IsMenuItem<R>> =
        Box::new(PredefinedMenuItem::fullscreen(app, None)?);
    #[cfg(not(target_os = "macos"))]
    let fullscreen_item: Box<dyn tauri::menu::IsMenuItem<R>> = Box::new(
        MenuItemBuilder::with_id("menu:toggle-fullscreen", "Toggle Fullscreen")
            .accelerator("F11")
            .build(app)?,
    );

    // ---- Help submenu ----
    let docs_item =
        MenuItemBuilder::with_id("menu:docs", "Documentation").build(app)?;
    let logs_item =
        MenuItemBuilder::with_id("menu:logs", "Open Logs Folder").build(app)?;
    let issues_item = MenuItemBuilder::with_id("menu:issues", "Report Issue").build(app)?;
    let updates_item =
        MenuItemBuilder::with_id("menu:check-updates", "Check for Updates").build(app)?;

    // ---- Build submenus ----
    let mut menu_builder = tauri::menu::MenuBuilder::new(app);

    // App submenu — only as a separate top-level on macOS. On Windows/Linux
    // the same items are folded into the File menu so users can still get
    // to Settings/Quit/About without a dedicated app submenu.
    #[cfg(target_os = "macos")]
    {
        let app_submenu = SubmenuBuilder::new(app, &pkg.name)
            .item(&about_item)
            .item(&separator()?)
            .item(&settings_item)
            .item(&separator()?)
            .item(&services_item)
            .item(&separator()?)
            .item(&hide_item)
            .item(&hide_others_item)
            .item(&show_all_item)
            .item(&separator()?)
            .item(&quit_item)
            .build()?;
        menu_builder = menu_builder.item(&app_submenu);
    }

    let file_submenu = {
        let mut b = SubmenuBuilder::new(app, "File")
            .item(&new_project_item)
            .item(&import_project_item)
            .item(&export_project_item)
            .item(&separator()?)
            .item(&close_window_item);
        // On non-macOS platforms surface About / Settings / Quit here so
        // they're discoverable without a dedicated app submenu.
        #[cfg(not(target_os = "macos"))]
        {
            b = b
                .item(&separator()?)
                .item(&settings_item)
                .item(&separator()?)
                .item(&about_item)
                .item(&separator()?)
                .item(&quit_item);
        }
        // Silence "unused services_item / hide / hide_others / show_all"
        // warnings on non-macOS targets where those items are macOS-only.
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (&services_item, &hide_item, &hide_others_item, &show_all_item);
        }
        b.build()?
    };
    menu_builder = menu_builder.item(&file_submenu);

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&undo_item)
        .item(&redo_item)
        .item(&separator()?)
        .item(&cut_item)
        .item(&copy_item)
        .item(&paste_item)
        .item(&separator()?)
        .item(&select_all_item)
        .build()?;
    menu_builder = menu_builder.item(&edit_submenu);

    let run_submenu = SubmenuBuilder::new(app, "Run")
        .item(&run_pipeline_item)
        .item(&cancel_run_item)
        .item(&separator()?)
        .item(&blender_item)
        .build()?;
    menu_builder = menu_builder.item(&run_submenu);

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(fullscreen_item.as_ref())
        .build()?;
    menu_builder = menu_builder.item(&view_submenu);

    // Window submenu — macOS only. On other platforms users have OS-level
    // chrome (taskbar etc.) for window control.
    #[cfg(target_os = "macos")]
    {
        let minimize_item = PredefinedMenuItem::minimize(app, None)?;
        let zoom_item = PredefinedMenuItem::maximize(app, Some("Zoom"))?;
        let bring_all_item = PredefinedMenuItem::bring_all_to_front(app, None)?;
        let window_submenu = SubmenuBuilder::new(app, "Window")
            .item(&minimize_item)
            .item(&zoom_item)
            .item(&separator()?)
            .item(&bring_all_item)
            .build()?;
        menu_builder = menu_builder.item(&window_submenu);
    }

    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(&docs_item)
        .item(&logs_item)
        .item(&separator()?)
        .item(&issues_item)
        .item(&separator()?)
        .item(&updates_item)
        .build()?;
    menu_builder = menu_builder.item(&help_submenu);

    menu_builder.build()
}

/// Handle a menu event by emitting the matching IPC event for the frontend.
///
/// Predefined menu items (Quit, Hide, Cut/Copy/Paste, etc.) handle
/// themselves natively via `muda` and never reach this dispatcher; only
/// custom items with our `menu:*` ids do.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    if !id.starts_with("menu:") {
        return;
    }

    // Special-case the on-app fullscreen toggle on Windows/Linux. We use
    // the active webview window's `set_fullscreen` API directly because
    // there's no predefined menu item for it on those platforms.
    #[cfg(not(target_os = "macos"))]
    if id == "menu:toggle-fullscreen" {
        if let Some(window) = app.get_webview_window("main") {
            let is_fullscreen = window.is_fullscreen().unwrap_or(false);
            let _ = window.set_fullscreen(!is_fullscreen);
        }
        return;
    }

    // Help-menu items that open URLs / folders are handled in Rust via
    // `tauri-plugin-opener` so we don't have to install a separate JS
    // opener package. Everything else relays to the frontend.
    match id {
        "menu:docs" => {
            let _ = app.opener().open_url(DOCS_URL, None::<&str>);
        }
        "menu:issues" => {
            let _ = app.opener().open_url(ISSUES_URL, None::<&str>);
        }
        "menu:logs" => {
            let log_dir = dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(".pipelinekit");
            let _ = std::fs::create_dir_all(&log_dir);
            let _ = app.opener().open_path(log_dir.to_string_lossy(), None::<&str>);
        }
        _ => {
            // Generic emit: relay the event to the frontend with no
            // payload. The React side has the dashboard context handlers
            // that can act on the active project / running run / etc.
            let _ = app.emit(id, ());
        }
    }
}
