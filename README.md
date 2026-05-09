<div align="center">
  <img src="docs/logo.svg" alt="PipelineKit" width="280">

  <p><strong>AI-orchestrated Blender production pipelines.</strong></p>
  <p>Type a brief, get a real scene. Render product visualizations, lighting setups, and turntables with typed Blender operations driven by your choice of LLM.</p>

  <p>
    <a href="https://github.com/pradhankukiran/pipeline-kit/releases/latest"><img src="https://img.shields.io/github/v/release/pradhankukiran/pipeline-kit?include_prereleases&label=release&color=0a0a0a&style=flat-square" alt="Latest release"></a>
    <a href="https://github.com/pradhankukiran/pipeline-kit/actions/workflows/ci.yml"><img src="https://github.com/pradhankukiran/pipeline-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT License"></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white&style=flat-square" alt="TypeScript">
    <img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB&style=flat-square" alt="React">
    <img src="https://img.shields.io/badge/Tauri-FFC131?logo=tauri&logoColor=black&style=flat-square" alt="Tauri">
    <img src="https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white&style=flat-square" alt="Rust">
    <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white&style=flat-square" alt="Vite">
    <img src="https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white&style=flat-square" alt="Tailwind CSS">
    <img src="https://img.shields.io/badge/shadcn/ui-000000?logo=shadcnui&logoColor=white&style=flat-square" alt="shadcn/ui">
    <img src="https://img.shields.io/badge/Node-339933?logo=nodedotjs&logoColor=white&style=flat-square" alt="Node.js">
    <img src="https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white&style=flat-square" alt="pnpm">
    <img src="https://img.shields.io/badge/Blender-E87D0D?logo=blender&logoColor=white&style=flat-square" alt="Blender">
  </p>
</div>

---

## Overview

PipelineKit is a desktop app that **orchestrates Blender via AI**. It uses LLMs to plan, dispatch, and review production work — not to replace your creative tools, but to drive them with typed operations and a real scheduler.

A pipeline run takes a prompt, plans a DAG via Groq, executes per-lane (Groq for fast structured work, OpenRouter for creative/vision review, Codex SDK for tool-heavy production, Blender MCP for actual scene/render operations), and surfaces every step with live progress, approvals, and render previews.

## Features

- **Typed Blender operations** — 8 first-class ops (`create_scene`, `studio_set`, `apply_material`, `lighting_rig`, `camera_rig`, `render_shot`, `inspect_scene`, `save_checkpoint`) with Zod-validated parameters.
- **Real Blender Python codegen** — recipe IDs (white-sweep, softbox-three-point, turntable-orbit, matte-clay, preview-1080p) compile to working `bpy` scripts that Blender executes via MCP.
- **DAG pipeline executor** — lane-aware scheduler with `dependsOn` support, real-time SSE event stream, and per-step approval gating.
- **Multi-lane orchestration** — Groq (planning), OpenRouter (creative/review), Codex SDK (production), Blender (execution). API keys configured via Settings modal, persisted locally.
- **Project & approval entities** — full CRUD with persistence, URL-driven routing (`/projects/:id/{overview,blender,runs,review,assets}`), live activity feed.
- **Asset library** — search Poly Haven CC0 assets + procedural recipes; one-click import HDRIs and materials directly into the running Blender scene.
- **Render capture** — every `render_shot` is saved to `~/.pipelinekit/renders/<runId>/<opId>.png`, served via `/renders/*` and shown as thumbnails in-app.
- **Live scene state** — polls Blender every 5 s and shows scene name, engine, frame range, object counts, active camera.
- **Single-command release** — push a `v*` tag, GitHub Actions builds Linux/Windows/macOS native installers in parallel and attaches them to a draft release.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Tauri 2 desktop  (Rust shell + React 18 + Vite + shadcn/ui)            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Topbar · Sidebar · routed views (Welcome / Project)               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                  ▲                                      │
│                                  │  HTTP + SSE  (127.0.0.1:4317)        │
│                                  ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Sidecar (Node, esbuild-bundled, spawned by Rust at app start)     │ │
│  │  ─ HTTP server  (~25 routes: projects, approvals, runs, blender)   │ │
│  │  ─ Pipeline orchestrator  (DAG, lanes, events, approval gating)    │ │
│  │  ─ Providers  (Groq, OpenRouter, Codex SDK)                        │ │
│  │  ─ Asset resolver  (procedural · Poly Haven · local fs)            │ │
│  │  ─ JSON persistence  (~/.pipelinekit/state.json, atomic writes)    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                  ▲                                      │
│                                  │  MCP stdio  (uvx blender-mcp)        │
│                                  ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Blender + MCP add-on  (executes generated bpy Python)             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Workspace

```
apps/
  desktop/              Tauri + React app
    src-tauri/          Rust shell + Tauri config
    src/                React UI (views, panels, layouts, shadcn primitives)
packages/
  core/                 Domain types, Zod schemas, pipeline contracts
  recipes/              Procedural recipe registry
  assets/               Asset resolver (procedural · Poly Haven · local fs)
  sidecar/              HTTP server, orchestrator, Blender bridge, providers
tools/
  sync-version.mjs      Keep root, Cargo.toml, tauri.conf in lockstep
.github/workflows/
  ci.yml                Typecheck, library build, cargo check on every push
  release.yml           Native installers on tag push (Linux + Windows + macOS)
```

## Quick Start

### Run from source

```bash
git clone https://github.com/pradhankukiran/pipeline-kit.git
cd pipeline-kit
pnpm install
pnpm dev                     # starts Vite + Tauri shell on :1420
# in another terminal:
pnpm --filter @pipelinekit/sidecar dev   # starts sidecar on :4317
```

### Configure API keys

Open the gear icon in the topbar → paste your Groq and (optional) OpenRouter keys → Save. Settings persist to `~/.pipelinekit/state.json`.

### Connect Blender

1. Install the [Blender MCP add-on](https://github.com/ahujasid/blender-mcp) in Blender.
2. Enable it from Edit → Preferences → Add-ons.
3. Open the N-panel in the 3D viewport, click "Connect to Claude / MCP".
4. In PipelineKit's Blender page, click **Connect Blender**, then **List Tools**.

## Installation

### Users

Download a build from [Releases](https://github.com/pradhankukiran/pipeline-kit/releases):

| Platform | File |
|---|---|
| Linux (Debian/Ubuntu) | `PipelineKit_x.y.z_amd64.deb` |
| Linux (RPM) | `PipelineKit-x.y.z-1.x86_64.rpm` |
| Linux (portable) | `PipelineKit_x.y.z_amd64.AppImage` |
| Windows | `PipelineKit_x.y.z_x64-setup.exe` or `_x64_en-US.msi` |
| macOS (universal) | `PipelineKit_x.y.z_universal.dmg` |

> **Requires Node 20+ on the system PATH.** The app spawns the bundled sidecar via `node`. Install Node from [nodejs.org](https://nodejs.org/) before launching.

The sidecar log lives at `~/.pipelinekit/sidecar.log`.

### Developers

Prerequisites: **Node 20+**, **pnpm 10+**, **Rust stable** (for Tauri builds).

```bash
pnpm install
```

#### Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Tauri dev (Vite + native shell, hot reload) |
| `pnpm --filter @pipelinekit/sidecar dev` | Run sidecar in TS watch mode on `:4317` |
| `pnpm -r typecheck` | Workspace-wide TypeScript check |
| `pnpm -r build` | Build all packages (libraries to `dist/`, sidecar to `dist-bundle/`) |
| `pnpm --filter @pipelinekit/sidecar bundle` | esbuild the sidecar to a single CJS file |
| `pnpm sync:version` | Propagate root version → Cargo.toml, tauri.conf.json |

When the sidecar is running on `:4317` (e.g., from `pnpm sidecar dev`), the Tauri app detects the open port and **skips spawning its bundled copy** — your dev sidecar stays in charge.

## Tauri Build

Build native installers locally:

```bash
cd apps/desktop
pnpm tauri build
```

Produces:
- `apps/desktop/src-tauri/target/release/bundle/deb/*.deb`
- `apps/desktop/src-tauri/target/release/bundle/rpm/*.rpm`
- `apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage`

The `beforeBuildCommand` chain runs `prebuild:desktop` which builds libraries → bundles the sidecar via esbuild → builds the Vite frontend, in that order.

## Releasing

```bash
# 1. Bump root package.json version
# 2. Sync into Cargo.toml + tauri.conf.json
pnpm sync:version

# 3. Commit + tag + push
git add -A && git commit -m "release: v0.x.y"
git tag v0.x.y
git push origin main --follow-tags
```

The `release.yml` workflow fires on the tag push and builds all three platforms in parallel (~7-15 min). Installers are attached to a **draft GitHub release** named after the tag — review and click **Publish** when ready.

To dry-run without releasing: GitHub Actions → release workflow → **Run workflow** → leave the tag input blank.

## CI

Every push and PR to `main` runs:
- `pnpm -r typecheck` — workspace-wide TS check
- Library build for `core`, `recipes`, `assets`, `sidecar`
- Sidecar esbuild bundle
- Vite production build for the desktop
- `cargo check` for the Tauri Rust shell

Status: ![CI](https://github.com/pradhankukiran/pipeline-kit/actions/workflows/ci.yml/badge.svg)

## Roadmap

- [ ] Multi-turn Codex SDK lane wired into a real scene-driving flow
- [ ] Live render thumbnails as they finish (currently shown post-completion)
- [ ] Drag-and-drop asset import
- [ ] Project import/export
- [ ] Code signing for Windows + macOS installers
- [ ] Auto-update channel via Tauri updater
- [ ] Optional Node SEA bundle so users don't need Node on their system

## License

[MIT](LICENSE) — Copyright &copy; 2026 Kiran Kumar Pradhan
