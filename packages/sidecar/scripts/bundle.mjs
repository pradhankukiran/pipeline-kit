// Bundle the PipelineKit sidecar into a single self-contained CommonJS file
// that can be shipped as a Tauri resource and spawned by the desktop shell.
//
// Output:
//   dist-bundle/pipelinekit-sidecar.cjs       (bundled entry)
//   dist-bundle/pipelinekit-sidecar.cjs.map   (linked source map)
//   dist-bundle/package.json                  ({"type":"commonjs"})
//
// Additionally copies the bundle into the Tauri app's resource directory at
// apps/desktop/src-tauri/resources/pipelinekit-sidecar.cjs so a subsequent
// `tauri build` includes it in the installed `.deb`/`.AppImage`.

import { build } from "esbuild";
import { mkdir, writeFile, copyFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sidecarRoot = resolve(here, "..");
const repoRoot = resolve(sidecarRoot, "..", "..");

const entry = resolve(sidecarRoot, "src/server/dev-server.ts");
const outdir = resolve(sidecarRoot, "dist-bundle");
const outfile = resolve(outdir, "pipelinekit-sidecar.cjs");
const tauriResourceDir = resolve(repoRoot, "apps/desktop/src-tauri/resources");
const tauriResource = resolve(tauriResourceDir, "pipelinekit-sidecar.cjs");

await mkdir(outdir, { recursive: true });
await mkdir(tauriResourceDir, { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile,
  platform: "node",
  target: "node20",
  format: "cjs",
  bundle: true,
  minify: true,
  sourcemap: "linked",
  // esbuild auto-externalizes `node:*` imports when platform is "node"; we
  // also preserve any node-builtin alias just in case a dep imports the
  // un-prefixed form.
  external: [],
  logLevel: "info",
  metafile: true,
  legalComments: "none"
});

// Write a sibling package.json so node interprets the .cjs as CommonJS even if
// some packaging context propagates `"type": "module"` from a parent dir.
await writeFile(
  resolve(outdir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
  "utf8"
);

// Copy into the Tauri resources directory so `tauri build` picks it up.
await copyFile(outfile, tauriResource);

const { size } = await stat(outfile);
const mb = (size / (1024 * 1024)).toFixed(2);

const errorCount = result.errors?.length ?? 0;
const warnCount = result.warnings?.length ?? 0;

console.log(
  `[pipelinekit-sidecar/bundle] wrote ${outfile} (${mb} MB) — ${errorCount} errors, ${warnCount} warnings`
);
console.log(`[pipelinekit-sidecar/bundle] copied to ${tauriResource}`);
