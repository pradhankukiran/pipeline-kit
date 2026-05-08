import type {
  Approval,
  ApprovalStatus,
  ID,
  OperationResult,
  PipelineOperation,
  Project
} from "@pipelinekit/core";
import type { PipelineStepResult } from "../contracts.js";
import {
  createJsonFileStore,
  STATE_SCHEMA_VERSION,
  type JsonFileStore,
  type PersistedState
} from "./persistence.js";

export interface ModelSettings {
  readonly groqModel: string;
  readonly groqApiKey: string;
  readonly openRouterModel: string;
  readonly openRouterApiKey: string;
  readonly codexModel: string;
}

export interface BlenderMcpSettings {
  readonly command: string;
  readonly args: readonly string[];
  readonly autoConnect: boolean;
}

export interface SidecarSettings {
  readonly models: ModelSettings;
  readonly blender: BlenderMcpSettings;
}

export interface BlenderConnectionState {
  readonly connected: boolean;
  readonly mode: "mcp" | "fallback";
  readonly lastConnectedAt?: string;
  readonly lastError?: string;
}

export interface RecentOperation {
  readonly operation: PipelineOperation | JsonOperation;
  readonly result: OperationResult;
  readonly projectId?: ID | null;
}

export type PipelineRunStatus = "running" | "completed" | "failed" | "rejected";

export interface PipelineRunRecord {
  readonly id: ID;
  readonly projectId: ID | null;
  readonly prompt?: string;
  readonly definitionId: string;
  readonly status: PipelineRunStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly results: readonly PipelineStepResult[];
}

export interface JsonOperation {
  readonly id: string;
  readonly projectId?: string;
  readonly type: string;
  readonly params: Record<string, unknown>;
  readonly risk?: "low" | "medium" | "high";
  readonly requiresApproval?: boolean;
  readonly createdAt?: string;
}

export interface SidecarState {
  settings: SidecarSettings;
  blender: BlenderConnectionState;
  recentOperations: RecentOperation[];
  pipelineRuns: PipelineRunRecord[];
  projects: Project[];
  activeProjectId: ID | null;
  approvals: Approval[];
}

export interface InitialStateLoadResult {
  readonly state: SidecarState;
  readonly store: JsonFileStore;
  readonly storePath: string;
  readonly loadedFromDisk: boolean;
}

const MAX_RECENT_OPERATIONS = 20;
const MAX_PIPELINE_RUNS = 20;

export function createSidecarState(): SidecarState {
  return {
    settings: createDefaultSettings(),
    blender: createInitialBlenderState(),
    recentOperations: [],
    pipelineRuns: [],
    projects: [],
    activeProjectId: null,
    approvals: []
  };
}

export async function loadInitialState(
  store: JsonFileStore = createJsonFileStore()
): Promise<InitialStateLoadResult> {
  const persisted = await store.load();
  const baseState = createSidecarState();

  let loadedFromDisk = false;
  if (persisted) {
    baseState.settings = mergeSettings(baseState.settings, persisted.settings);
    baseState.recentOperations = sanitizeRecentOperations(persisted.recentOperations);
    baseState.pipelineRuns = sanitizePipelineRuns(persisted.pipelineRuns);
    baseState.projects = sanitizeProjects(persisted.projects);
    baseState.activeProjectId = sanitizeActiveProjectId(persisted.activeProjectId, baseState.projects);
    baseState.approvals = sanitizeApprovals(persisted.approvals);
    loadedFromDisk = true;
  }

  const proxied = wrapWithPersistence(baseState, store);
  return {
    state: proxied,
    store,
    storePath: store.path,
    loadedFromDisk
  };
}

export function updateSettings(current: SidecarSettings, patch: unknown): SidecarSettings {
  if (!isRecord(patch)) {
    throw new Error("Expected a settings object.");
  }

  const models = isRecord(patch["models"]) ? patch["models"] : {};
  const blender = isRecord(patch["blender"]) ? patch["blender"] : {};
  const groq = isRecord(patch["groq"]) ? patch["groq"] : undefined;
  const openRouter = isRecord(patch["openRouter"]) ? patch["openRouter"] : undefined;
  const nextCommand =
    typeof blender["command"] === "string" && blender["command"].trim().length > 0
      ? blender["command"].trim()
      : current.blender.command;

  return {
    models: {
      groqModel: readString(models["groqModel"], current.models.groqModel),
      groqApiKey: readApiKeyField(
        groq ? groq["apiKey"] : undefined,
        models["groqApiKey"],
        current.models.groqApiKey
      ),
      openRouterModel: readString(models["openRouterModel"], current.models.openRouterModel),
      openRouterApiKey: readApiKeyField(
        openRouter ? openRouter["apiKey"] : undefined,
        models["openRouterApiKey"],
        current.models.openRouterApiKey
      ),
      codexModel: readString(models["codexModel"], current.models.codexModel)
    },
    blender: {
      command: nextCommand,
      args: readStringArray(blender["args"], current.blender.args),
      autoConnect: readBoolean(blender["autoConnect"], current.blender.autoConnect)
    }
  };
}

export function recordOperation(
  state: SidecarState,
  entry: RecentOperation,
  projectId?: ID | null
): void {
  const resolvedProjectId =
    projectId !== undefined
      ? projectId
      : entry.projectId !== undefined
        ? entry.projectId
        : state.activeProjectId ?? null;
  const next: RecentOperation = { ...entry, projectId: resolvedProjectId };
  state.recentOperations = [next, ...state.recentOperations].slice(0, MAX_RECENT_OPERATIONS);
}

export function recordPipelineRun(state: SidecarState, run: PipelineRunRecord): void {
  state.pipelineRuns = [run, ...state.pipelineRuns].slice(0, MAX_PIPELINE_RUNS);
}

export type PipelineRunPatch = Partial<
  Pick<PipelineRunRecord, "status" | "completedAt" | "results">
>;

/**
 * Replaces the matching pipeline-run record in `state.pipelineRuns` with a
 * merged copy that carries the supplied patch fields. The replacement triggers
 * the persistence Proxy because we reassign the array. If no record matches
 * `runId` the state is left untouched.
 */
export function updatePipelineRun(
  state: SidecarState,
  runId: ID,
  patch: PipelineRunPatch
): PipelineRunRecord | null {
  const existing = state.pipelineRuns.find((run) => run.id === runId);
  if (!existing) {
    return null;
  }

  const next: PipelineRunRecord = {
    ...existing,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
    ...(patch.results !== undefined ? { results: patch.results } : {})
  };

  state.pipelineRuns = state.pipelineRuns.map((run) => (run.id === runId ? next : run));
  return next;
}

export function addProject(state: SidecarState, project: Project): Project {
  state.projects = [...state.projects, project];
  return project;
}

export function updateProject(
  state: SidecarState,
  id: ID,
  patch: Partial<Pick<Project, "name" | "description" | "brief">>
): Project | null {
  const existing = state.projects.find((project) => project.id === id);
  if (!existing) {
    return null;
  }

  const next: Project = {
    ...existing,
    ...(typeof patch.name === "string" ? { name: patch.name } : {}),
    ...(typeof patch.description === "string" ? { description: patch.description } : {}),
    ...(typeof patch.brief === "string" ? { brief: patch.brief } : {}),
    updatedAt: new Date().toISOString()
  };

  state.projects = state.projects.map((project) => (project.id === id ? next : project));
  return next;
}

export function deleteProject(state: SidecarState, id: ID): boolean {
  const exists = state.projects.some((project) => project.id === id);
  if (!exists) {
    return false;
  }

  state.projects = state.projects.filter((project) => project.id !== id);
  if (state.activeProjectId === id) {
    state.activeProjectId = null;
  }
  return true;
}

export function setActiveProject(state: SidecarState, id: ID | null): boolean {
  if (id === null) {
    state.activeProjectId = null;
    return true;
  }

  const exists = state.projects.some((project) => project.id === id);
  if (!exists) {
    return false;
  }

  state.activeProjectId = id;
  return true;
}

export function addApproval(state: SidecarState, approval: Approval): Approval {
  state.approvals = [...state.approvals, approval];
  return approval;
}

export interface DecideApprovalOptions {
  readonly reason?: string;
  readonly decidedBy?: string;
}

export type DecideApprovalResult =
  | { readonly kind: "ok"; readonly approval: Approval }
  | { readonly kind: "not-found" }
  | { readonly kind: "already-decided"; readonly approval: Approval };

export function decideApproval(
  state: SidecarState,
  id: ID,
  status: Exclude<ApprovalStatus, "pending">,
  options: DecideApprovalOptions = {}
): DecideApprovalResult {
  const existing = state.approvals.find((approval) => approval.id === id);
  if (!existing) {
    return { kind: "not-found" };
  }

  if (existing.status !== "pending") {
    return { kind: "already-decided", approval: existing };
  }

  const next: Approval = {
    ...existing,
    status,
    decidedAt: new Date().toISOString(),
    decidedBy: typeof options.decidedBy === "string" && options.decidedBy.trim().length > 0
      ? options.decidedBy
      : "user",
    ...(typeof options.reason === "string" && options.reason.trim().length > 0
      ? { reason: options.reason }
      : {})
  };

  state.approvals = state.approvals.map((approval) => (approval.id === id ? next : approval));
  return { kind: "ok", approval: next };
}

function wrapWithPersistence(state: SidecarState, store: JsonFileStore): SidecarState {
  const persistFireAndForget = (): void => {
    const snapshot: PersistedState = {
      schemaVersion: STATE_SCHEMA_VERSION,
      settings: state.settings,
      recentOperations: state.recentOperations,
      pipelineRuns: state.pipelineRuns,
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      approvals: state.approvals
    };

    store.save(snapshot).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[pipelinekit-sidecar] failed to persist state: ${message}\n`);
    });
  };

  return new Proxy(state, {
    set(target, property, value) {
      Reflect.set(target, property, value);
      if (
        property === "settings" ||
        property === "recentOperations" ||
        property === "pipelineRuns" ||
        property === "projects" ||
        property === "activeProjectId" ||
        property === "approvals"
      ) {
        persistFireAndForget();
      }
      return true;
    }
  });
}

function mergeSettings(base: SidecarSettings, persisted: SidecarSettings): SidecarSettings {
  return {
    models: {
      groqModel: persisted.models?.groqModel ?? base.models.groqModel,
      groqApiKey:
        typeof persisted.models?.groqApiKey === "string"
          ? persisted.models.groqApiKey
          : base.models.groqApiKey,
      openRouterModel: persisted.models?.openRouterModel ?? base.models.openRouterModel,
      openRouterApiKey:
        typeof persisted.models?.openRouterApiKey === "string"
          ? persisted.models.openRouterApiKey
          : base.models.openRouterApiKey,
      codexModel: persisted.models?.codexModel ?? base.models.codexModel
    },
    blender: {
      command: persisted.blender?.command ?? base.blender.command,
      args: Array.isArray(persisted.blender?.args) ? persisted.blender.args : base.blender.args,
      autoConnect:
        typeof persisted.blender?.autoConnect === "boolean"
          ? persisted.blender.autoConnect
          : base.blender.autoConnect
    }
  };
}

function sanitizeRecentOperations(items: readonly RecentOperation[]): RecentOperation[] {
  return items.slice(0, MAX_RECENT_OPERATIONS).filter((item): item is RecentOperation => {
    return isRecord(item) && isRecord(item.operation) && isRecord(item.result);
  });
}

function sanitizePipelineRuns(
  items: readonly PipelineRunRecord[] | undefined
): PipelineRunRecord[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const result: PipelineRunRecord[] = [];
  for (const item of items.slice(0, MAX_PIPELINE_RUNS)) {
    if (!isRecord(item)) {
      continue;
    }
    if (
      typeof item["id"] !== "string" ||
      !(typeof item["projectId"] === "string" || item["projectId"] === null) ||
      typeof item["definitionId"] !== "string" ||
      typeof item["startedAt"] !== "string" ||
      !Array.isArray(item["results"])
    ) {
      continue;
    }

    const completedAt = typeof item["completedAt"] === "string" ? item["completedAt"] : undefined;
    const rawStatus = item["status"];
    const status: PipelineRunStatus =
      rawStatus === "running" ||
      rawStatus === "completed" ||
      rawStatus === "failed" ||
      rawStatus === "rejected"
        ? rawStatus
        : inferStatusFromLegacyRecord(item["results"], completedAt);

    const sanitized: PipelineRunRecord = {
      id: item["id"],
      projectId: item["projectId"] as ID | null,
      ...(typeof item["prompt"] === "string" ? { prompt: item["prompt"] } : {}),
      definitionId: item["definitionId"],
      status,
      startedAt: item["startedAt"],
      ...(completedAt !== undefined ? { completedAt } : {}),
      results: item["results"] as readonly PipelineStepResult[]
    };

    result.push(sanitized);
  }
  return result;
}

/**
 * Maps a pre-status-field record to a status: if `completedAt` is set we infer
 * `completed` (all results succeeded/skipped) or `failed` / `rejected` from the
 * results; without `completedAt` we treat the record as still running. This
 * keeps state files written before the `status` field was introduced loadable.
 */
function inferStatusFromLegacyRecord(
  rawResults: unknown,
  completedAt: string | undefined
): PipelineRunStatus {
  if (completedAt === undefined) {
    return "running";
  }
  if (!Array.isArray(rawResults)) {
    return "completed";
  }

  let anyFailed = false;
  let anyRejected = false;
  for (const entry of rawResults) {
    if (!isRecord(entry)) {
      continue;
    }
    if (entry["status"] === "failed") {
      anyFailed = true;
      const error = entry["error"];
      if (typeof error === "string" && error.startsWith("Step rejected:")) {
        anyRejected = true;
      }
    }
  }

  if (anyRejected) {
    return "rejected";
  }
  if (anyFailed) {
    return "failed";
  }
  return "completed";
}

function sanitizeProjects(items: readonly Project[] | undefined): Project[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.filter((item): item is Project => {
    if (!isRecord(item)) {
      return false;
    }
    return (
      typeof item["id"] === "string" &&
      typeof item["name"] === "string" &&
      typeof item["createdAt"] === "string" &&
      typeof item["updatedAt"] === "string"
    );
  });
}

function sanitizeActiveProjectId(value: unknown, projects: readonly Project[]): ID | null {
  if (typeof value !== "string") {
    return null;
  }
  return projects.some((project) => project.id === value) ? value : null;
}

function sanitizeApprovals(items: readonly Approval[] | undefined): Approval[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.filter((item): item is Approval => {
    if (!isRecord(item)) {
      return false;
    }
    const status = item["status"];
    return (
      typeof item["id"] === "string" &&
      typeof item["projectId"] === "string" &&
      typeof item["kind"] === "string" &&
      typeof item["summary"] === "string" &&
      (status === "pending" || status === "approved" || status === "rejected") &&
      typeof item["createdAt"] === "string"
    );
  });
}

function createInitialBlenderState(): BlenderConnectionState {
  return {
    connected: false,
    mode: "fallback"
  };
}

function createDefaultSettings(): SidecarSettings {
  const defaultBlenderCommand = process.platform === "win32" ? "blender-socket" : "uvx";
  const defaultBlenderArgs = process.platform === "win32" ? [] : ["blender-mcp"];

  return {
    models: {
      groqModel: process.env["PIPELINEKIT_GROQ_MODEL"] ?? "llama-3.1-8b-instant",
      groqApiKey:
        process.env["PIPELINEKIT_GROQ_API_KEY"] ?? process.env["GROQ_API_KEY"] ?? "",
      openRouterModel: process.env["PIPELINEKIT_OPENROUTER_MODEL"] ?? "openai/gpt-4o-mini",
      openRouterApiKey:
        process.env["PIPELINEKIT_OPENROUTER_API_KEY"] ?? process.env["OPENROUTER_API_KEY"] ?? "",
      codexModel: process.env["PIPELINEKIT_CODEX_MODEL"] ?? "gpt-5-codex"
    },
    blender: {
      command: process.env["PIPELINEKIT_BLENDER_MCP_COMMAND"] ?? defaultBlenderCommand,
      args: readEnvArgs(process.env["PIPELINEKIT_BLENDER_MCP_ARGS"]) ?? defaultBlenderArgs,
      autoConnect: process.env["PIPELINEKIT_BLENDER_MCP_AUTOCONNECT"] === "1"
    }
  };
}

function readEnvArgs(raw: string | undefined): readonly string[] | undefined {
  if (!raw) {
    return undefined;
  }

  return raw
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * Resolves an API key field from a settings POST body, preferring the nested
 * provider envelope (`patch.groq.apiKey`) over the flat form
 * (`patch.models.groqApiKey`). Empty strings are accepted (the user may have
 * intentionally cleared the field). If neither is present, returns the
 * caller-supplied fallback (typically the current value).
 */
function readApiKeyField(nested: unknown, flat: unknown, fallback: string): string {
  if (typeof nested === "string") {
    return nested.trim();
  }
  if (typeof flat === "string") {
    return flat.trim();
  }
  return fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length === value.length ? strings : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
