import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { searchAssets, type AssetSearchRequest } from "@pipelinekit/assets";
import {
  createWaterBottleProductVizDemoOperations,
  type Approval,
  type ApprovalStatus,
  type Project
} from "@pipelinekit/core";
import type { PipelineDefinition } from "../contracts.js";
import { OrchestratorService } from "../orchestrator/orchestrator-service.js";
import { planPipelineFromPrompt } from "../orchestrator/planner.js";
import { BlenderOperationAdapter } from "./blender-adapter.js";
import { demoPipeline } from "./demo-project.js";
import { ServerEventBroker, createRunIdFilter } from "./events.js";
import { handleRenderRequest } from "./render-handler.js";
import { handleAssetImport } from "./asset-import-handler.js";
import { handleSceneInfo } from "./scene-info-handler.js";
import {
  addApproval,
  addProject,
  decideApproval,
  deleteProject,
  loadInitialState,
  recordOperation,
  setActiveProject,
  updateProject,
  updateSettings,
  type JsonOperation,
  type SidecarState
} from "./state.js";

declare module "node:fs/promises" {
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }

  export interface Stats {
    size: number;
    mtimeMs: number;
  }

  export function readdir(
    path: string,
    options: { withFileTypes: true }
  ): Promise<Dirent[]>;
  export function stat(path: string): Promise<Stats>;
}

declare module "node:path" {
  export const sep: string;
  export function relative(from: string, to: string): string;
  export function resolve(...segments: string[]): string;
}

const DEFAULT_PORT = 4317;
const MAX_BODY_BYTES = 1024 * 1024;

export interface SidecarDevServerOptions {
  readonly port?: number;
  readonly host?: string;
}

export interface SidecarDevServerHandle {
  readonly server: Server;
  readonly state: SidecarState;
  readonly adapter: BlenderOperationAdapter;
  readonly statePath: string;
}

type JsonRecord = Record<string, unknown>;

export async function createSidecarDevServer(): Promise<SidecarDevServerHandle> {
  const events = new ServerEventBroker();
  const { state, storePath: statePath } = await loadInitialState();
  const blender = new BlenderOperationAdapter(state);
  const orchestratorService = new OrchestratorService({
    state,
    blender,
    eventSink: events
  });

  const server = createServer(async (request, response) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/renders/")) {
      const pathParam = request.url.slice("/renders/".length).split("?")[0] ?? "";
      await handleRenderRequest(request, response, pathParam);
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, {
          ok: true,
          service: "pipelinekit-sidecar",
          blender: state.blender,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/settings") {
        writeJson(response, 200, {
          settings: state.settings,
          blender: state.blender
        });
        return;
      }

      if ((request.method === "POST" || request.method === "PUT") && url.pathname === "/settings") {
        const body = await readJsonBody(request);
        state.settings = updateSettings(state.settings, isRecord(body) && isRecord(body["settings"]) ? body["settings"] : body);
        state.blender = {
          connected: false,
          mode: "fallback"
        };
        writeJson(response, 200, {
          ok: true,
          settings: state.settings,
          blender: state.blender
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/project/demo") {
        writeJson(response, 200, {
          project: {
            id: "demo",
            name: "PipelineKit Demo"
          },
          snapshot: createDemoSnapshot(),
          pipeline: demoPipeline
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/pipeline/sample") {
        writeJson(response, 200, createDemoSnapshot());
        return;
      }

      if (request.method === "POST" && url.pathname === "/pipeline/run") {
        const body = await readJsonBody(request);
        const pipeline = await parsePipelineRequest(body, state);
        const projectId = readProjectIdFromBody(body, state);
        const prompt = readPromptFromBody(body);
        const { results } = await orchestratorService.runPipeline(pipeline, {
          projectId,
          ...(prompt ? { prompt } : {})
        });
        writeJson(response, 200, {
          pipelineId: pipeline.id,
          results
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/pipeline/runs") {
        let pipeline: PipelineDefinition;
        let projectId: string | null;
        let prompt: string | undefined;
        try {
          const body = await readJsonBody(request);
          pipeline = await parsePipelineRequest(body, state);
          projectId = readProjectIdFromBody(body, state);
          prompt = readPromptFromBody(body);
        } catch (parseError) {
          const message = parseError instanceof Error ? parseError.message : String(parseError);
          writeJson(response, 400, { ok: false, error: message });
          return;
        }

        const { runId } = orchestratorService.runPipelineAsync(pipeline, {
          projectId,
          ...(prompt ? { prompt } : {})
        });
        const encodedRunId = encodeURIComponent(runId);
        writeJson(response, 202, {
          runId,
          status: "running",
          runUrl: `/pipeline/runs/${encodedRunId}`,
          eventsUrl: `/events?runId=${encodedRunId}`
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/pipeline/sample/run") {
        const body = await readJsonBody(request);
        const projectId = readProjectIdFromBody(body, state);
        const { results } = await orchestratorService.runPipeline(demoPipeline, {
          projectId
        });
        writeJson(response, 200, {
          ok: true,
          message: "Sample planner run completed",
          pipelineId: demoPipeline.id,
          results,
          snapshot: createDemoSnapshot({
            metrics: {
              progress: "76%",
              blockers: "3",
              assets: "141",
              review: "7 notes"
            },
            board: [
              {
                title: "Groq summarized the production brief",
                owner: "Groq",
                status: "Completed",
                lane: "Brief"
              },
              {
                title: "OpenRouter drafted the shot plan",
                owner: "OpenRouter",
                status: "Completed",
                lane: "Direction"
              },
              {
                title: "Blender execution plan prepared",
                owner: "Codex",
                status: "Queued",
                lane: "Scene"
              }
            ]
          })
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/blender/sync") {
        writeJson(response, 200, {
          ok: true,
          message: state.blender.connected
            ? "Blender bridge sync checked; MCP transport is connected."
            : "Blender bridge sync checked; MCP transport is ready to configure.",
          blender: state.blender,
          snapshot: createDemoSnapshot({
            blenderSession: {
              title: state.blender.connected
                ? "Blender MCP bridge / connected"
                : "Blender MCP bridge / configured",
              scene: state.blender.connected ? "Scene: live Blender connection" : "Scene: awaiting live Blender connection",
              connected: state.blender.connected
            }
          })
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/blender/connect") {
        const body = await readJsonBody(request);
        const maybeSettings = isRecord(body) && isRecord(body["settings"]) ? body["settings"] : undefined;
        if (maybeSettings) {
          state.settings = updateSettings(state.settings, maybeSettings);
        }
        await blender.connect();
        writeJson(response, 200, {
          ok: state.blender.connected,
          message: state.blender.connected
            ? "Blender MCP connected"
            : state.blender.lastError ?? "Blender MCP connection failed; fallback mode is active.",
          blender: state.blender,
          settings: state.settings.blender
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/blender/tools") {
        const tools = await blender.listTools();
        writeJson(response, 200, {
          ok: true,
          blender: state.blender,
          ...tools
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/blender/operation") {
        const body = await readJsonBody(request);
        const operation = parseOperationRequest(body);
        const projectId = readProjectIdFromBody(body, state);
        const result = await blender.runOperation(operation);
        recordOperation(state, { operation, result }, projectId);
        writeJson(response, 200, {
          ok: result.status === "succeeded",
          blender: state.blender,
          operation,
          result
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/blender/scene-info") {
        await handleSceneInfo(request, response, blender);
        return;
      }

      if (request.method === "POST" && url.pathname === "/blender/import-asset") {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (parseError) {
          writeJson(response, 400, {
            ok: false,
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
          return;
        }
        await handleAssetImport(request, response, blender, body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/blender/demo/product-viz") {
        const body = await readJsonBody(request);
        const operations = createProductVizOperations(body);
        const results = [];
        for (const operation of operations) {
          const result = await blender.runOperation(operation);
          recordOperation(state, { operation, result }, operation.projectId ?? null);
          results.push(result);
        }

        writeJson(response, 200, {
          ok: results.every((result) => result.status === "succeeded"),
          blender: state.blender,
          operations,
          results,
          snapshot: createDemoSnapshot({
            metrics: {
              progress: "82%",
              blockers: state.blender.connected ? "0" : "1",
              assets: "18",
              review: "1 note"
            },
            blenderSession: {
              title: state.blender.connected ? "Blender MCP bridge / connected" : "Blender MCP bridge / fallback",
              scene: "Scene: product visualization operation set prepared",
              connected: state.blender.connected
            }
          })
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/assets/search") {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (parseError) {
          const message = parseError instanceof Error ? parseError.message : String(parseError);
          writeJson(response, 400, { ok: false, error: `Invalid JSON body: ${message}` });
          return;
        }

        const input = isRecord(body) ? body : {};
        const limitRaw = input["limit"];
        const limit =
          typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.floor(limitRaw)
            : 25;
        const tagsValue = input["tags"];
        const tags = Array.isArray(tagsValue)
          ? tagsValue.filter((tag): tag is string => typeof tag === "string")
          : undefined;
        const searchRequest: AssetSearchRequest = {
          query: typeof input["query"] === "string" ? input["query"] : undefined,
          kind: typeof input["kind"] === "string" ? (input["kind"] as AssetSearchRequest["kind"]) : undefined,
          tags,
          limit
        };
        const useRecipeCandidates =
          typeof input["useRecipeCandidates"] === "boolean" ? input["useRecipeCandidates"] : true;

        try {
          const result = searchAssets(searchRequest, { useRecipeCandidates });
          writeJson(response, 200, { ok: true, candidates: [...result] });
        } catch (resolverError) {
          const message = resolverError instanceof Error ? resolverError.message : String(resolverError);
          writeJson(response, 500, { ok: false, error: message });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/operations/recent") {
        const projectIdFilter = url.searchParams.get("projectId");
        const operations =
          projectIdFilter !== null
            ? state.recentOperations.filter(
                (entry) => (entry.projectId ?? null) === projectIdFilter
              )
            : state.recentOperations;
        writeJson(response, 200, { operations });
        return;
      }

      if (request.method === "GET" && url.pathname === "/pipeline/runs") {
        const projectIdFilter = url.searchParams.get("projectId");
        const runs =
          projectIdFilter !== null
            ? state.pipelineRuns.filter((run) => (run.projectId ?? null) === projectIdFilter)
            : state.pipelineRuns;
        writeJson(response, 200, { runs });
        return;
      }

      const pipelineRunIdMatch = url.pathname.match(/^\/pipeline\/runs\/([^/]+)$/);
      if (pipelineRunIdMatch && request.method === "GET") {
        const runId = decodeURIComponent(pipelineRunIdMatch[1]);
        const run = state.pipelineRuns.find((entry) => entry.id === runId);
        if (!run) {
          writeJson(response, 404, { ok: false, error: "Pipeline run not found." });
          return;
        }
        writeJson(response, 200, { run });
        return;
      }

      if (request.method === "GET" && url.pathname === "/events") {
        const runIdFilter = url.searchParams.get("runId");
        const filter = createRunIdFilter(runIdFilter);
        const cleanup = events.addClient(response, filter ? { filter } : {});
        request.on("close", cleanup);
        return;
      }

      if (request.method === "GET" && url.pathname === "/projects") {
        writeJson(response, 200, {
          projects: state.projects,
          activeProjectId: state.activeProjectId
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/projects") {
        const body = await readJsonBody(request);
        const input = isRecord(body) ? body : {};
        const name = typeof input["name"] === "string" ? input["name"].trim() : "";
        if (name.length === 0) {
          writeJson(response, 400, { ok: false, error: "Expected name to be a non-empty string." });
          return;
        }

        const now = new Date().toISOString();
        const project: Project = {
          id: crypto.randomUUID(),
          name,
          ...(typeof input["description"] === "string" ? { description: input["description"] } : {}),
          ...(typeof input["brief"] === "string" ? { brief: input["brief"] } : {}),
          createdAt: now,
          updatedAt: now
        };
        addProject(state, project);
        writeJson(response, 200, { project });
        return;
      }

      if (request.method === "POST" && url.pathname === "/projects/active") {
        const body = await readJsonBody(request);
        const input = isRecord(body) ? body : {};
        const idValue = input["id"];
        if (idValue !== null && typeof idValue !== "string") {
          writeJson(response, 400, {
            ok: false,
            error: "Expected id to be a string or null."
          });
          return;
        }

        if (idValue !== null && !state.projects.some((project) => project.id === idValue)) {
          writeJson(response, 404, { ok: false, error: "Project not found." });
          return;
        }

        setActiveProject(state, idValue);
        writeJson(response, 200, {
          ok: true,
          activeProjectId: state.activeProjectId
        });
        return;
      }

      const projectIdMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
      if (projectIdMatch && projectIdMatch[1] !== "active") {
        const projectId = decodeURIComponent(projectIdMatch[1]);
        if (request.method === "GET") {
          const project = state.projects.find((entry) => entry.id === projectId);
          if (!project) {
            writeJson(response, 404, { ok: false, error: "Project not found." });
            return;
          }
          writeJson(response, 200, { project });
          return;
        }

        if (request.method === "PATCH") {
          const body = await readJsonBody(request);
          const input = isRecord(body) ? body : {};
          const patch: { name?: string; description?: string; brief?: string } = {};
          if (typeof input["name"] === "string") {
            const trimmed = input["name"].trim();
            if (trimmed.length === 0) {
              writeJson(response, 400, { ok: false, error: "Expected name to be a non-empty string." });
              return;
            }
            patch.name = trimmed;
          }
          if (typeof input["description"] === "string") {
            patch.description = input["description"];
          }
          if (typeof input["brief"] === "string") {
            patch.brief = input["brief"];
          }

          const updated = updateProject(state, projectId, patch);
          if (!updated) {
            writeJson(response, 404, { ok: false, error: "Project not found." });
            return;
          }
          writeJson(response, 200, { project: updated });
          return;
        }

        if (request.method === "DELETE") {
          const removed = deleteProject(state, projectId);
          if (!removed) {
            writeJson(response, 404, { ok: false, error: "Project not found." });
            return;
          }
          writeJson(response, 200, { ok: true });
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/approvals") {
        const projectIdFilter = url.searchParams.get("projectId");
        const statusFilter = url.searchParams.get("status");
        const filtered = state.approvals.filter((approval) => {
          if (projectIdFilter && approval.projectId !== projectIdFilter) {
            return false;
          }
          if (statusFilter && approval.status !== statusFilter) {
            return false;
          }
          return true;
        });
        writeJson(response, 200, { approvals: filtered });
        return;
      }

      if (request.method === "POST" && url.pathname === "/approvals") {
        const body = await readJsonBody(request);
        const input = isRecord(body) ? body : {};
        const projectId = typeof input["projectId"] === "string" ? input["projectId"].trim() : "";
        const kind = typeof input["kind"] === "string" ? input["kind"].trim() : "";
        const summary = typeof input["summary"] === "string" ? input["summary"].trim() : "";
        if (projectId.length === 0 || kind.length === 0 || summary.length === 0) {
          writeJson(response, 400, {
            ok: false,
            error: "Expected projectId, kind, and summary to be non-empty strings."
          });
          return;
        }

        const approval: Approval = {
          id: crypto.randomUUID(),
          projectId,
          kind,
          summary,
          status: "pending",
          ...(input["payload"] !== undefined ? { payload: input["payload"] } : {}),
          createdAt: new Date().toISOString()
        };
        addApproval(state, approval);
        writeJson(response, 200, { approval });
        return;
      }

      const approvalDecideMatch = url.pathname.match(/^\/approvals\/([^/]+)\/decide$/);
      if (approvalDecideMatch && request.method === "POST") {
        const approvalId = decodeURIComponent(approvalDecideMatch[1]);
        const body = await readJsonBody(request);
        const input = isRecord(body) ? body : {};
        const status = input["status"];
        if (status !== "approved" && status !== "rejected") {
          writeJson(response, 400, {
            ok: false,
            error: "Expected status to be 'approved' or 'rejected'."
          });
          return;
        }

        const reason = typeof input["reason"] === "string" ? input["reason"] : undefined;
        const decidedBy = typeof input["decidedBy"] === "string" ? input["decidedBy"] : undefined;

        const result = decideApproval(state, approvalId, status as Exclude<ApprovalStatus, "pending">, {
          reason,
          decidedBy
        });
        if (result.kind === "not-found") {
          writeJson(response, 404, { ok: false, error: "Approval not found." });
          return;
        }
        if (result.kind === "already-decided") {
          writeJson(response, 409, {
            ok: false,
            error: "already-decided",
            approval: result.approval
          });
          return;
        }
        writeJson(response, 200, { approval: result.approval });
        return;
      }

      writeJson(response, 404, {
        error: "Not found"
      });
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return { server, state, adapter: blender, statePath };
}

function createDemoSnapshot(overrides: JsonRecord = {}): JsonRecord {
  return {
    currentProject: "PipelineKit Demo",
    navItems: [
      { id: "projects", label: "Projects", meta: "1 live" },
      { id: "brief", label: "Brief", meta: "draft" },
      { id: "production", label: "Production Board", meta: "3 tasks" },
      { id: "blender", label: "Blender Session", meta: "pending" },
      { id: "assets", label: "Assets", meta: "procedural + Poly Haven" },
      { id: "shots", label: "Shot Board", meta: "3 shots" },
      { id: "review", label: "Review", meta: "ready" },
      { id: "settings", label: "Settings", meta: "local" }
    ],
    metrics: {
      progress: "64%",
      blockers: "1",
      assets: "12",
      review: "0 notes"
    },
    projects: [
      {
        name: "PipelineKit Demo",
        client: "Internal",
        status: "Active",
        due: "Local",
        progress: 64,
        shots: "0/3"
      }
    ],
    brief: [
      {
        label: "Look",
        value: "Clean product visualization, procedural studio set, Poly Haven material pass."
      },
      {
        label: "Delivery",
        value: "Three-shot contact sheet and Blender checkpoint."
      },
      {
        label: "Guardrails",
        value: "Codex executes local Blender operations only after validation."
      }
    ],
    board: [
      {
        title: "Extract structured brief",
        owner: "Groq",
        status: "Queued",
        lane: "Brief"
      },
      {
        title: "Draft shot and lookdev plan",
        owner: "OpenRouter",
        status: "Queued",
        lane: "Direction"
      },
      {
        title: "Prepare Blender MCP execution",
        owner: "Codex",
        status: "Queued",
        lane: "Scene"
      }
    ],
    blenderSession: {
      title: "Blender MCP bridge / not connected",
      scene: "Scene: no live Blender scene",
      connected: false
    },
    assets: [
      {
        name: "studio-set:white-sweep",
        kind: "Recipe",
        source: "Procedural",
        state: "Ready"
      },
      {
        name: "lighting-rig:softbox-three-point",
        kind: "Recipe",
        source: "Procedural",
        state: "Ready"
      },
      {
        name: "Poly Haven material search",
        kind: "Material",
        source: "Poly Haven",
        state: "Available"
      }
    ],
    shots: [
      ["SH010", "Hero front three-quarter", "Planned", "still", "Queued"],
      ["SH020", "Macro material detail", "Planned", "still", "Queued"],
      ["SH030", "Turntable orbit", "Planned", "0:08", "Queued"]
    ],
    reviewNotes: [
      "No renders reviewed yet.",
      "Planner endpoint is connected to the local sidecar."
    ],
    ...overrides
  };
}

export async function startSidecarDevServer(
  options: SidecarDevServerOptions = {}
): Promise<SidecarDevServerHandle> {
  const port = options.port ?? readPort();
  const host = options.host ?? process.env["PIPELINEKIT_SIDECAR_HOST"] ?? "127.0.0.1";
  const handle = await createSidecarDevServer();

  console.log(`[pipelinekit-sidecar] state loaded from ${handle.statePath}`);

  const autoConnect = shouldAutoConnect();
  if (autoConnect) {
    console.log("[pipelinekit-sidecar] auto-connect enabled");
    try {
      await handle.adapter.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[pipelinekit-sidecar] Blender auto-connect failed: ${message}`);
    }
  }

  handle.server.listen(port, host, () => {
    const address = handle.server.address();
    const displayAddress =
      typeof address === "object" && address ? `${address.address}:${address.port}` : String(address);
    console.log(`PipelineKit sidecar dev server listening on http://${displayAddress}`);
  });
  return handle;
}

function shouldAutoConnect(): boolean {
  const raw = process.env["PIPELINEKIT_BLENDER_MCP_AUTOCONNECT"];
  if (!raw) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

async function parsePipelineRequest(body: unknown, state: SidecarState): Promise<PipelineDefinition> {
  if (!isRecord(body) || Object.keys(body).length === 0) {
    return demoPipeline;
  }

  if (isPipelineDefinition(body)) {
    return body;
  }

  if (isPipelineDefinition(body["pipeline"])) {
    return body["pipeline"];
  }

  if (body["pipeline"] === "sample" || body["pipeline"] === "demo") {
    return demoPipeline;
  }

  if (typeof body["prompt"] === "string") {
    const pipelineId = typeof body["id"] === "string" ? body["id"] : `run-${Date.now()}`;
    return await planPipelineFromPrompt(body["prompt"], { settings: state.settings }, pipelineId);
  }

  throw new Error(
    'Expected a PipelineDefinition, { pipeline: "sample" | PipelineDefinition }, { prompt }, or an empty body.'
  );
}

/**
 * Reads `projectId` from a request body, supporting top-level and nested
 * `arguments.projectId` envelopes (the latter mirrors how the desktop UI
 * forwards Blender quick-op arguments). Returns the supplied value when it is
 * a non-empty string or `null`. Otherwise falls back to `state.activeProjectId`
 * (or `null` when none is set).
 */
function readProjectIdFromBody(body: unknown, state: SidecarState): string | null {
  if (isRecord(body)) {
    if (typeof body["projectId"] === "string" && body["projectId"].length > 0) {
      return body["projectId"];
    }
    if (body["projectId"] === null) {
      return null;
    }
    const args = body["arguments"];
    if (isRecord(args)) {
      if (typeof args["projectId"] === "string" && args["projectId"].length > 0) {
        return args["projectId"];
      }
      if (args["projectId"] === null) {
        return null;
      }
    }
    const operation = body["operation"];
    if (isRecord(operation)) {
      if (typeof operation["projectId"] === "string" && operation["projectId"].length > 0) {
        return operation["projectId"];
      }
    }
  }
  return state.activeProjectId ?? null;
}

function readPromptFromBody(body: unknown): string | undefined {
  if (isRecord(body) && typeof body["prompt"] === "string" && body["prompt"].length > 0) {
    return body["prompt"];
  }
  return undefined;
}

function parseOperationRequest(body: unknown): JsonOperation {
  const value = isRecord(body) && isRecord(body["operation"]) ? body["operation"] : body;
  if (!isRecord(value)) {
    throw new Error("Expected an operation object or { operation }.");
  }

  if (typeof value["type"] !== "string" || value["type"].trim().length === 0) {
    throw new Error("Expected operation.type to be a non-empty string.");
  }

  return {
    id: readString(value["id"], `operation-${Date.now()}`),
    projectId: typeof value["projectId"] === "string" ? value["projectId"] : undefined,
    type: value["type"].trim(),
    params: isRecord(value["params"]) ? value["params"] : {},
    risk: readRisk(value["risk"]),
    requiresApproval: typeof value["requiresApproval"] === "boolean" ? value["requiresApproval"] : false,
    createdAt: readString(value["createdAt"], new Date().toISOString())
  };
}

function createProductVizOperations(body: unknown): readonly JsonOperation[] {
  const input = isRecord(body) ? body : {};
  const projectId = readString(input["projectId"], "demo");
  const idPrefix = readString(input["idPrefix"], `water-bottle-${Date.now()}`);
  const now = new Date().toISOString();

  return createWaterBottleProductVizDemoOperations({
    projectId,
    idPrefix,
    createdAt: now
  });
}

function isPipelineDefinition(value: unknown): value is PipelineDefinition {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    isRecord(value["input"]) &&
    typeof value["input"]["prompt"] === "string" &&
    Array.isArray(value["steps"])
  );
}

function readRisk(value: unknown): JsonOperation["risk"] {
  return value === "low" || value === "medium" || value === "high" ? value : "low";
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length > 0 ? JSON.parse(text) : {};
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function writeJson(response: ServerResponse, statusCode: number, body: JsonRecord): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body, null, 2));
}

function readPort(): number {
  const rawPort = process.env["PIPELINEKIT_SIDECAR_PORT"];
  if (!rawPort) {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PIPELINEKIT_SIDECAR_PORT value: ${rawPort}`);
  }

  return port;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
