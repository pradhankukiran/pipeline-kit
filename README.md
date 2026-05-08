# PipelineKit

PipelineKit is a local AI production pipeline for Blender. It uses AI to plan, orchestrate, inspect, and revise production work rather than to replace the creative toolchain.

## Product Shape

- Desktop shell: Tauri 2
- UI: React, TypeScript, Vite
- Orchestrator: Node.js sidecar
- State: SQLite-ready project model
- Local production agent: Codex SDK
- Fast model lane: Groq
- Creative/review model lane: OpenRouter
- Blender control: Blender MCP
- Assets: procedural recipes, Poly Haven, optional local asset library

## Workspace

```text
apps/desktop      Tauri + React app
packages/core     shared domain model and orchestration contracts
packages/sidecar  local service adapters and pipeline runner
packages/recipes  procedural asset recipe registry
packages/assets   asset source contracts and Poly Haven/local adapters
```

## Sidecar packaging

The desktop app ships the sidecar as a single bundled CommonJS file. On launch
the Rust shell spawns it via `node` and tears it down on exit.

### Users (installed `.deb` / `.AppImage`)

- Requires **Node 20+** on the system PATH. The app spawns the bundled sidecar
  with `node`; if `node` is not installed, the sidecar will fail to start and
  the app will surface a startup error. Install Node from your distro or
  [nodejs.org](https://nodejs.org/) before launching.
- The sidecar log lives at `~/.pipelinekit/sidecar.log`.

### Developers

- `pnpm sidecar dev` (or `pnpm --filter @pipelinekit/sidecar dev`) runs the
  sidecar in TS watch mode on `127.0.0.1:4317`. When the desktop app starts and
  detects port `4317` is already listening, it skips the bundled-sidecar
  spawn — your dev sidecar stays in charge.
- `pnpm --filter @pipelinekit/sidecar bundle` produces
  `packages/sidecar/dist-bundle/pipelinekit-sidecar.cjs` and copies it into
  `apps/desktop/src-tauri/resources/`. The root `prebuild:desktop` script does
  this before each Tauri release build (wired through `beforeBuildCommand`).

## Releasing

Update `version` in the root `package.json`, then run:

```
pnpm sync:version
```

This propagates the version into `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/src-tauri/tauri.conf.json`. Then commit, tag, and build.
