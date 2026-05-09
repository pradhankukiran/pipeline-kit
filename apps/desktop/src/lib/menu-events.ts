/**
 * Subscribes the React app to native menu IPC events emitted from the
 * Tauri backend. Each menu item that doesn't map to a predefined OS
 * action emits a `menu:<id>` event from `apps/desktop/src-tauri/src/menu.rs`;
 * this module provides a single hook that wires those events to the
 * dashboard context handlers and a few light navigation actions.
 *
 * Rust-side handlers (`menu.rs`) cover help-menu items that just open
 * URLs / folders via `tauri-plugin-opener`, so the frontend doesn't need
 * to listen for `menu:docs`, `menu:logs`, or `menu:issues`.
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useDashboard } from "@/dashboard-context";
import { checkForUpdate, formatUpdateBanner } from "@/lib/updater";

type Unlisten = () => void;

export function useMenuEvents(): void {
  const navigate = useNavigate();
  const {
    activeProjectId,
    setSettingsOpen,
    handleExportProject,
    handleImportProject,
    handleRunPlanner,
    setSubmitBanner,
    availableUpdate,
    setAvailableUpdate
  } = useDashboard();

  useEffect(() => {
    // Each `listen` returns a Promise<Unlisten>. We collect all promises
    // and wait for them to resolve in a flat array of unlisten functions
    // so the cleanup runs synchronously when the effect tears down.
    const unlistens: Promise<Unlisten>[] = [];

    unlistens.push(
      listen("menu:settings", () => {
        setSettingsOpen(true);
      })
    );

    unlistens.push(
      listen("menu:new-project", () => {
        // Welcome page hosts the "Create project" form.
        navigate("/");
      })
    );

    unlistens.push(
      listen("menu:export-project", () => {
        if (!activeProjectId) {
          setSubmitBanner("Select a project before exporting.");
          return;
        }
        void handleExportProject();
      })
    );

    unlistens.push(
      listen("menu:import-project", () => {
        // Reuse the same hidden file input the topbar uses by triggering
        // a click on it — but we don't have a global ref to it. Instead
        // we open a programmatic file picker via a transient input.
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json";
        input.style.display = "none";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) {
            input.remove();
            return;
          }
          try {
            const text = await file.text();
            const bundle = JSON.parse(text) as object;
            await handleImportProject(bundle);
          } catch (err) {
            const reason =
              err instanceof Error
                ? err.message
                : "Could not read or parse the bundle";
            setSubmitBanner(`Import failed: ${reason}`);
          } finally {
            input.remove();
          }
        };
        document.body.appendChild(input);
        input.click();
      })
    );

    unlistens.push(
      listen("menu:run-pipeline", () => {
        void handleRunPlanner();
      })
    );

    unlistens.push(
      listen("menu:cancel-run", () => {
        // Cancellation is per-run and lives inside PipelineRunsPanel,
        // which owns the live run subscriptions. Surface a hint so the
        // user knows where to act; a future revision can wire this
        // directly to the panel via a global cancel handler.
        setSubmitBanner(
          "Open the Runs panel to cancel an in-progress pipeline run."
        );
      })
    );

    unlistens.push(
      listen("menu:blender", () => {
        if (activeProjectId) {
          navigate(`/projects/${activeProjectId}/blender`);
        } else {
          setSubmitBanner("Select a project to open its Blender page.");
        }
      })
    );

    unlistens.push(
      listen("menu:check-updates", () => {
        void (async () => {
          // If the launch-time poll already discovered an update, jump
          // straight to the install prompt — no need to re-check the
          // endpoint just to rediscover the same release.
          const cached = availableUpdate;
          if (cached) {
            const ok = window.confirm(
              `PipelineKit ${cached.version} is available.\n\n` +
                "Update now? The app will download the installer and " +
                "restart automatically when it's ready."
            );
            if (!ok) {
              setSubmitBanner("Update postponed. Use Help → Check for Updates when you're ready.");
              return;
            }
            setSubmitBanner(`Downloading PipelineKit ${cached.version}…`);
            try {
              await cached.downloadAndInstall();
            } catch (err) {
              const reason =
                err instanceof Error ? err.message : "Update failed";
              setSubmitBanner(`Update failed: ${reason}`);
            }
            return;
          }

          setSubmitBanner("Checking for updates…");
          const result = await checkForUpdate({ silent: false });
          if (!result || result.kind === "unsupported") {
            setSubmitBanner(
              "Update checks aren't available in this dev runtime."
            );
            return;
          }
          if (result.kind === "up-to-date") {
            setSubmitBanner("PipelineKit is up to date.");
            return;
          }
          if (result.kind === "error") {
            setSubmitBanner(`Update check failed: ${result.message}`);
            return;
          }
          // result.kind === "available"
          setAvailableUpdate(result.update);
          const ok = window.confirm(
            `PipelineKit ${result.update.version} is available.\n\n` +
              "Update now? The app will download the installer and " +
              "restart automatically when it's ready."
          );
          if (!ok) {
            setSubmitBanner(formatUpdateBanner(result.update));
            return;
          }
          setSubmitBanner(`Downloading PipelineKit ${result.update.version}…`);
          try {
            await result.update.downloadAndInstall();
          } catch (err) {
            const reason =
              err instanceof Error ? err.message : "Update failed";
            setSubmitBanner(`Update failed: ${reason}`);
          }
        })();
      })
    );

    return () => {
      // Tear down all listeners. We do this lazily — if any unlisten
      // promise hasn't resolved by the time the component unmounts, the
      // .then chain will still fire and unsubscribe.
      for (const p of unlistens) {
        void p.then((unlisten) => unlisten());
      }
    };
  }, [
    navigate,
    activeProjectId,
    setSettingsOpen,
    handleExportProject,
    handleImportProject,
    handleRunPlanner,
    setSubmitBanner,
    availableUpdate,
    setAvailableUpdate
  ]);
}
