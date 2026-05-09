# PipelineKit desktop deployment notes

This file documents the two distribution-readiness pieces that don't fit
cleanly into `tauri.conf.json` or the source: how the auto-updater is
signed and shipped, and how the `pipelinekit://` deep-link scheme is
registered with the host OS. The actual configuration values live in:

- `apps/desktop/src-tauri/tauri.conf.json` — `plugins.updater` /
  `plugins.deep-link`
- `apps/desktop/src-tauri/capabilities/default.json` — `updater:default`
  and `deep-link:default`
- `apps/desktop/src-tauri/desktop-template.desktop` — Linux MimeType
  registration for the URL scheme
- `.github/workflows/release.yml` — CI signing-key plumbing

## How updater works

The desktop app uses `tauri-plugin-updater` to self-update from GitHub
release artifacts.

1. **Release manifest endpoint.** `tauri.conf.json` points
   `plugins.updater.endpoints` at:
   `https://github.com/pradhankukiran/pipeline-kit/releases/latest/download/latest.json`.
   Every signed release publishes a `latest.json` alongside the
   installers; the app polls it on launch (gated by the per-user
   `checkForUpdatesOnLaunch` setting) and via `Help → Check for Updates`.

2. **Signing keypair.** Generate it once with
   `pnpm exec tauri signer generate --ci -p "" -f -w pipelinekit-updater.key`.
   That writes a private key (`.key`) and matching public key (`.pub`).
   The public key is committed to `tauri.conf.json` under
   `plugins.updater.pubkey`. **The private key is secret** — paste its
   full contents into the GitHub repository secret named
   `TAURI_SIGNING_PRIVATE_KEY`. The companion
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret should remain empty
   because the keypair was generated with no password; only set it if
   the key is ever rotated under a passphrase.

3. **Automatic `latest.json` generation.** The release workflow runs
   `tauri-apps/tauri-action@v0` with both signing-key env vars set. When
   it builds installers it also signs them with the private key and
   uploads a `latest.json` manifest to the GitHub release. Releases
   without the secret set will still publish installers but omit
   `latest.json`, leaving the auto-updater inert.

4. **Runtime behavior.** The frontend wraps the plugin in
   `apps/desktop/src/lib/updater.ts`. `checkForUpdate({ silent: true })`
   runs once at startup and quietly populates a banner when a newer
   release exists. The Help-menu version (non-silent) prompts the user
   via `window.confirm` before downloading + restarting via
   `update.downloadAndInstall()`.

## How deep links work

The desktop app registers the `pipelinekit://` URL scheme so other apps
(browser, terminal, CLI) can open specific projects / runs / renders
without going through the file picker.

1. **OS-level registration.**
   - macOS / iOS: `plugins.deep-link.desktop.schemes` in
     `tauri.conf.json` is read at bundle time and emits a
     `CFBundleURLTypes` entry in the .app's `Info.plist`.
   - Windows: same config produces a registry key that maps
     `pipelinekit://` to the installed binary.
   - Linux: `desktop-template.desktop` lists
     `x-scheme-handler/pipelinekit` in its `MimeType=` line so
     `xdg-mime` knows the AppImage / deb is the handler. The
     `application/x-pipelinekit-project` mimetype stays for `.json`
     project bundles.

2. **Supported routes.** The frontend hook
   `apps/desktop/src/lib/deep-links.ts` parses three URL shapes and
   maps them to in-app routes:

   | URL                                          | Effect                                                     |
   | -------------------------------------------- | ---------------------------------------------------------- |
   | `pipelinekit://project/<projectId>`          | Navigates to `/projects/<projectId>/overview`              |
   | `pipelinekit://run/<runId>`                  | Resolves the run, navigates to `…/runs?run=<runId>`        |
   | `pipelinekit://render/<runId>/<opId>`        | Resolves the run, navigates to `…/blender` + banner hint   |

   Unknown routes (or URLs whose project/run can't be resolved) surface
   a SubmitBanner so the user sees why the click didn't do what they
   expected.

3. **Launch race.** When the user clicks a `pipelinekit://` link while
   the app is closed, the OS spawns the binary with the URL. The plugin
   buffers it; the React hook calls `getCurrent()` once on mount to
   replay the queued URL through the same dispatcher used for
   `onOpenUrl` events, so the launch-time link still routes correctly
   even though the webview wasn't ready when the URL arrived.

## Releasing a new version

1. Bump `apps/desktop/src-tauri/tauri.conf.json` `version` and the
   matching `apps/desktop/package.json`.
2. Tag the commit `vX.Y.Z` and push the tag — the release workflow
   builds Linux / macOS / Windows installers and (if the signing secret
   is set) publishes a signed `latest.json`.
3. Verify the draft release on GitHub, attach release notes, and
   publish. Existing installs will pick up the update on next launch
   (silent check) or via Help → Check for Updates.
