/**
 * Thin wrapper around `@tauri-apps/plugin-updater` with the same banner-only
 * UX that the rest of the desktop shell uses for transient status messages.
 *
 * The plugin throws if the runtime isn't a Tauri webview (e.g. plain `pnpm
 * dev` against a browser, or unit tests). Every entry point is wrapped in a
 * try/catch so a missing/unreachable updater endpoint never crashes the
 * React tree — the caller just gets `null` back.
 */
import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateInfo = {
  /** Semantic version string from the manifest (e.g. "0.2.1"). */
  version: string;
  /** Optional release notes / changelog body the manifest carries. */
  body: string;
  /** Trigger the download + install + restart flow. */
  downloadAndInstall: () => Promise<void>;
};

export type CheckResult =
  | { kind: "available"; update: UpdateInfo }
  | { kind: "up-to-date" }
  | { kind: "error"; message: string }
  | { kind: "unsupported" };

/**
 * Run a single update check against the configured endpoint.
 *
 * - `silent: true` is intended for the on-launch background poll. It returns
 *   `null` on any non-available outcome so the caller doesn't surface a
 *   banner when the user didn't ask for one.
 * - `silent: false` (or unset) returns the full {@link CheckResult} so the
 *   caller can render distinct banners for "up to date" / errors / etc.
 */
export async function checkForUpdate(
  opts: { silent?: boolean } = {}
): Promise<CheckResult | null> {
  const silent = opts.silent === true;
  try {
    const result = await check();
    if (!result) {
      return silent ? null : { kind: "up-to-date" };
    }
    const update: Update = result;
    return {
      kind: "available",
      update: {
        version: update.version,
        body: typeof update.body === "string" ? update.body : "",
        downloadAndInstall: () => update.downloadAndInstall()
      }
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Update check failed";
    // Outside of a Tauri runtime the plugin throws synchronously with a
    // distinctive message — surface it as "unsupported" so callers can
    // ignore it cleanly during dev.
    if (
      /window\.__TAURI__|not running|isTauri/i.test(message) ||
      /forbidden/i.test(message) ||
      /not allowed/i.test(message)
    ) {
      console.warn("[updater] runtime not available:", message);
      return silent ? null : { kind: "unsupported" };
    }
    if (silent) {
      console.warn("[updater] silent check failed:", message);
      return null;
    }
    return { kind: "error", message };
  }
}

/**
 * Convenience helper: format the installer prompt the launch-time and
 * menu-driven flows both show before kicking off a download. The banner
 * itself is a plain string today, so this builds the matching string.
 */
export function formatUpdateBanner(update: UpdateInfo): string {
  return `PipelineKit ${update.version} is available. Open Help → Check for Updates to install now.`;
}
