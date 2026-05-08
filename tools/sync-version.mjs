#!/usr/bin/env node
// Propagates the canonical version from the root package.json into the Tauri
// Cargo.toml and tauri.conf.json. Idempotent: re-running with everything in
// sync is a no-op.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const rootPkgPath = resolve(repoRoot, "package.json");
const cargoPath = resolve(repoRoot, "apps/desktop/src-tauri/Cargo.toml");
const tauriConfPath = resolve(repoRoot, "apps/desktop/src-tauri/tauri.conf.json");

async function readCanonicalVersion() {
  const raw = await readFile(rootPkgPath, "utf8");
  const pkg = JSON.parse(raw);
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`Root package.json has no usable "version" field`);
  }
  return pkg.version;
}

async function syncCargoToml(version) {
  const raw = await readFile(cargoPath, "utf8");

  // Find the [package] section so we only edit the version inside it.
  const pkgHeaderMatch = raw.match(/^\[package\][^\S\n]*$/m);
  if (!pkgHeaderMatch) {
    throw new Error(`Cargo.toml is missing a [package] section`);
  }
  const pkgStart = pkgHeaderMatch.index + pkgHeaderMatch[0].length;

  // The [package] section ends at the next [section-header] or EOF.
  const nextHeaderRel = raw.slice(pkgStart).search(/^\[[^\]]+\][^\S\n]*$/m);
  const pkgEnd = nextHeaderRel === -1 ? raw.length : pkgStart + nextHeaderRel;

  const before = raw.slice(0, pkgStart);
  const pkgSection = raw.slice(pkgStart, pkgEnd);
  const after = raw.slice(pkgEnd);

  const versionLineRe = /^version = "([^"]*)"$/m;
  const m = pkgSection.match(versionLineRe);
  if (!m) {
    throw new Error(`Cargo.toml [package] section has no version line`);
  }
  const current = m[1];
  if (current === version) {
    console.log(`Cargo.toml: already ${version}`);
    return;
  }

  const updatedSection = pkgSection.replace(versionLineRe, `version = "${version}"`);
  await writeFile(cargoPath, before + updatedSection + after);
  console.log(`Cargo.toml: ${current} → ${version}`);
}

async function syncTauriConf(version) {
  const raw = await readFile(tauriConfPath, "utf8");
  const conf = JSON.parse(raw);
  const current = conf.version;
  if (current === version) {
    console.log(`tauri.conf.json: already ${version}`);
    return;
  }
  conf.version = version;
  await writeFile(tauriConfPath, JSON.stringify(conf, null, 2) + "\n");
  console.log(`tauri.conf.json: ${current} → ${version}`);
}

async function main() {
  const version = await readCanonicalVersion();
  await syncCargoToml(version);
  await syncTauriConf(version);
}

main().catch((err) => {
  console.error(`sync-version: ${err.message}`);
  process.exit(1);
});
