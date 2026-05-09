/**
 * Deep-link plumbing for the PipelineKit desktop shell.
 *
 * The `pipelinekit://` URL scheme is registered at the OS level in
 * tauri.conf.json + the Linux .desktop template. The plugin emits
 * incoming URLs through `onOpenUrl` after the webview has mounted, and
 * caches one URL via `getCurrent` if the app was launched by a click on
 * a deep link (the launch-time URL would otherwise race the webview).
 *
 * Supported routes
 * ----------------
 *   pipelinekit://project/<projectId>
 *     Activates the project (if it exists) and navigates to its
 *     overview page. Unknown ids surface a banner.
 *
 *   pipelinekit://run/<runId>
 *     Resolves the run via `getPipelineRun` to find its projectId, then
 *     navigates to /projects/<projectId>/runs?run=<runId>. RunsPage can
 *     scroll to / focus the run by inspecting the `run` search param.
 *
 *   pipelinekit://render/<runId>/<opId>
 *     Same projectId resolution as runs; navigates to the project's
 *     Blender page and surfaces a banner pointing the user at the
 *     specific op id.
 *
 * Anything else is logged + dropped. The hook is intentionally
 * idempotent: parsing failures don't crash the React tree, the plugin
 * just calls our handler again the next time a URL arrives.
 */
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";

import type { ProjectRecord } from "@/sidecarApi";
import { getPipelineRun } from "@/sidecarApi";

type SetBanner = (message: string | null) => void;

type Dispatcher = {
  navigate: NavigateFunction;
  setSubmitBanner: SetBanner;
  projects: ProjectRecord[];
};

type ParsedDeepLink =
  | { kind: "project"; projectId: string }
  | { kind: "run"; runId: string }
  | { kind: "render"; runId: string; opId: string }
  | { kind: "unknown"; raw: string };

/**
 * Best-effort URL parser. The plugin can pass any of:
 *   - "pipelinekit://project/abc"
 *   - "pipelinekit://run/abc?foo=bar"
 *   - { url: "pipelinekit://..." } (older builds)
 * Whatever it hands us, we pull a string out and try to parse.
 */
function parseDeepLink(raw: unknown): ParsedDeepLink | null {
  const url = typeof raw === "string" ? raw : null;
  if (!url) return null;
  if (!url.startsWith("pipelinekit://")) {
    return { kind: "unknown", raw: url };
  }
  // Strip the scheme + any leading slashes, then split on `?` for query.
  const withoutScheme = url.slice("pipelinekit://".length);
  const [path] = withoutScheme.split("?", 1);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) {
    return { kind: "unknown", raw: url };
  }
  const [head, ...rest] = parts;
  if (head === "project" && rest.length >= 1) {
    return { kind: "project", projectId: decodeURIComponent(rest[0]) };
  }
  if (head === "run" && rest.length >= 1) {
    return { kind: "run", runId: decodeURIComponent(rest[0]) };
  }
  if (head === "render" && rest.length >= 2) {
    return {
      kind: "render",
      runId: decodeURIComponent(rest[0]),
      opId: decodeURIComponent(rest[1])
    };
  }
  return { kind: "unknown", raw: url };
}

async function dispatchDeepLink(
  parsed: ParsedDeepLink,
  ctx: Dispatcher
): Promise<void> {
  if (parsed.kind === "unknown") {
    console.warn("[deep-links] dropped unrecognised URL:", parsed.raw);
    ctx.setSubmitBanner(`Unknown deep link: ${parsed.raw}`);
    return;
  }

  if (parsed.kind === "project") {
    const exists = ctx.projects.some((p) => p.id === parsed.projectId);
    if (!exists) {
      ctx.setSubmitBanner(`Project ${parsed.projectId} not found`);
      return;
    }
    ctx.navigate(`/projects/${parsed.projectId}/overview`);
    return;
  }

  if (parsed.kind === "run") {
    try {
      const { run } = await getPipelineRun(parsed.runId);
      const projectId = run.projectId;
      if (!projectId) {
        ctx.setSubmitBanner(
          `Run ${parsed.runId.slice(0, 8)} has no associated project`
        );
        return;
      }
      ctx.navigate(
        `/projects/${projectId}/runs?run=${encodeURIComponent(parsed.runId)}`
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Could not resolve run";
      ctx.setSubmitBanner(
        `Run ${parsed.runId.slice(0, 8)} not found (${reason})`
      );
    }
    return;
  }

  if (parsed.kind === "render") {
    try {
      const { run } = await getPipelineRun(parsed.runId);
      const projectId = run.projectId;
      if (!projectId) {
        ctx.setSubmitBanner(
          `Render's run ${parsed.runId.slice(0, 8)} has no project`
        );
        return;
      }
      ctx.navigate(`/projects/${projectId}/blender`);
      ctx.setSubmitBanner(
        `Render ${parsed.opId} from run ${parsed.runId.slice(0, 8)} — open the runs panel for the linked output.`
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Could not resolve run";
      ctx.setSubmitBanner(
        `Render link failed for run ${parsed.runId.slice(0, 8)}: ${reason}`
      );
    }
    return;
  }
}

/**
 * Subscribe to incoming `pipelinekit://` URLs and replay any URL queued
 * by the OS launch handler. Safe to call exactly once per app lifecycle.
 *
 * The hook is a no-op when the plugin isn't available (browser dev,
 * test runtime). Errors are logged so unrecognised URL shapes don't
 * tear down the React tree.
 */
export function useDeepLinks(
  navigate: NavigateFunction,
  setSubmitBanner: SetBanner,
  projects: ProjectRecord[]
): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const ctx: Dispatcher = { navigate, setSubmitBanner, projects };

    void (async () => {
      try {
        // Replay the queued launch URL, if any. Tauri returns an array
        // because some platforms can buffer multiple URLs before the
        // webview is ready; we only act on the first.
        const queued = await getCurrent();
        if (!cancelled && Array.isArray(queued) && queued.length > 0) {
          const parsed = parseDeepLink(queued[0]);
          if (parsed) {
            await dispatchDeepLink(parsed, ctx);
          }
        }
      } catch (err) {
        console.warn("[deep-links] getCurrent failed:", err);
      }

      try {
        const handle = await onOpenUrl((urls) => {
          const first = Array.isArray(urls) ? urls[0] : null;
          const parsed = parseDeepLink(first);
          if (!parsed) {
            return;
          }
          void dispatchDeepLink(parsed, ctx);
        });
        if (cancelled) {
          handle();
        } else {
          unlisten = handle;
        }
      } catch (err) {
        console.warn("[deep-links] onOpenUrl failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [navigate, setSubmitBanner, projects]);
}
