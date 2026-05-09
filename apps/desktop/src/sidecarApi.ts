import type { OperationRecord, PipelineSettings, PipelineSnapshot } from "./fallbackData";

export type SidecarHealth = {
  ok: boolean;
  status: "online" | "offline" | "degraded";
  message: string;
  checkedAt: string;
  blender?: {
    connected?: boolean;
    version?: string;
    scene?: string;
  };
};

export type ApiResult<T> = {
  data: T | null;
  error: string | null;
  endpoint?: string;
};

export type SidecarActionResult = {
  ok: boolean;
  message: string;
  endpoint?: string;
  snapshot?: Partial<PipelineSnapshot>;
  operation?: OperationRecord;
};

export type BlenderTool = {
  name: string;
  description: string;
};

export type BlenderOperationRequest = {
  tool: string;
  arguments?: Record<string, unknown>;
};

export type AssetCandidate = {
  id: string;
  label: string;
  source: string;
  kind?: string;
  score: number;
  reason?: string;
  tags?: string[];
  categories?: string[];
  metadata?: Record<string, unknown>;
};

export type AssetSearchResponse = {
  ok: boolean;
  candidates: AssetCandidate[];
  error?: string;
};

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:4317";
const REQUEST_TIMEOUT_MS = 2500;

export const sidecarBaseUrl =
  import.meta.env.VITE_PIPELINEKIT_SIDECAR_URL?.replace(/\/+$/, "") || DEFAULT_SIDECAR_URL;

async function requestJson<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const endpoint = `${sidecarBaseUrl}${path}`;

  try {
    const response = await fetch(endpoint, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init?.headers
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return { data: null, error: `${response.status} ${response.statusText}`, endpoint };
    }

    const data = (await response.json()) as T;
    return { data, error: null, endpoint };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sidecar request failed";
    return { data: null, error: message, endpoint };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function firstAvailable<T>(paths: string[], init?: RequestInit): Promise<ApiResult<T>> {
  let lastError = "No endpoint attempted";

  for (const path of paths) {
    const result = await requestJson<T>(path, init);
    if (result.data) {
      return result;
    }

    lastError = result.error ?? lastError;
  }

  return { data: null, error: lastError };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readApiError(data: Record<string, unknown>): string | undefined {
  if (data.ok !== false) {
    return undefined;
  }
  return typeof data.message === "string"
    ? data.message
    : typeof data.error === "string"
      ? data.error
      : "Request failed";
}

function normalizeHealth(value: unknown): SidecarHealth {
  const data = asRecord(value);
  const blender = asRecord(data.blender);
  const ok = data.ok === true || data.status === "ok" || data.status === "online";

  return {
    ok,
    status: ok ? "online" : data.status === "degraded" ? "degraded" : "offline",
    message: typeof data.message === "string" ? data.message : ok ? "Sidecar reachable" : "Sidecar unavailable",
    checkedAt: typeof data.checkedAt === "string" ? data.checkedAt : new Date().toISOString(),
    blender: {
      connected: typeof blender.connected === "boolean" ? blender.connected : undefined,
      version: typeof blender.version === "string" ? blender.version : undefined,
      scene: typeof blender.scene === "string" ? blender.scene : undefined
    }
  };
}

function unwrapSnapshot(value: unknown): Partial<PipelineSnapshot> {
  const data = asRecord(value);
  const nested = data.snapshot ?? data.pipeline ?? data.data;
  return (nested && typeof nested === "object" ? nested : data) as Partial<PipelineSnapshot>;
}

function normalizeSettings(value: unknown): Partial<PipelineSettings> {
  const data = asRecord(value);
  const settings = asRecord(data.settings ?? data);
  const models = asRecord(settings.models);
  const blender = asRecord(settings.blender ?? settings.blenderMcp);
  const groq = asRecord(settings.groq);
  const openRouter = asRecord(settings.openRouter ?? settings.openrouter);

  return {
    blenderMcpCommand: typeof settings.blenderMcpCommand === "string"
      ? settings.blenderMcpCommand
      : typeof blender.command === "string"
        ? blender.command
        : undefined,
    blenderMcpArgs: typeof settings.blenderMcpArgs === "string"
      ? settings.blenderMcpArgs
      : Array.isArray(blender.args)
        ? blender.args.join(" ")
        : typeof blender.args === "string"
          ? blender.args
          : undefined,
    autoConnect: typeof settings.autoConnect === "boolean"
      ? settings.autoConnect
      : typeof blender.autoConnect === "boolean"
        ? blender.autoConnect
        : undefined,
    groqModel: typeof settings.groqModel === "string"
      ? settings.groqModel
      : typeof models.groqModel === "string"
        ? models.groqModel
      : typeof groq.model === "string"
        ? groq.model
        : undefined,
    groqApiKey: typeof settings.groqApiKey === "string"
      ? settings.groqApiKey
      : typeof groq.apiKey === "string"
        ? groq.apiKey
        : undefined,
    openRouterModel: typeof settings.openRouterModel === "string"
      ? settings.openRouterModel
      : typeof models.openRouterModel === "string"
        ? models.openRouterModel
      : typeof openRouter.model === "string"
        ? openRouter.model
        : undefined,
    openRouterApiKey: typeof settings.openRouterApiKey === "string"
      ? settings.openRouterApiKey
      : typeof openRouter.apiKey === "string"
        ? openRouter.apiKey
        : undefined
  };
}

function normalizeTool(value: unknown): BlenderTool {
  const data = asRecord(value);
  const name = typeof data.name === "string" ? data.name : "unnamed_tool";
  return {
    name,
    description: typeof data.description === "string" ? data.description : "No description exposed"
  };
}

function unwrapTools(value: unknown): BlenderTool[] {
  const data = asRecord(value);
  const toolsEnvelope = asRecord(data.tools);
  const rawTools = Array.isArray(value)
    ? value
    : Array.isArray(data.tools)
      ? data.tools
      : Array.isArray(toolsEnvelope.tools)
        ? toolsEnvelope.tools
      : Array.isArray(data.data)
        ? data.data
        : [];

  return rawTools.map(normalizeTool);
}

function normalizeOperation(value: unknown, fallbackTitle: string): OperationRecord {
  const data = asRecord(value);
  const nestedOperation = asRecord(data.operation);
  const nestedResult = asRecord(data.result);
  const rawStatus = typeof data.status === "string"
    ? data.status.toLowerCase()
    : typeof nestedResult.status === "string"
      ? nestedResult.status.toLowerCase()
      : "";
  const status: OperationRecord["status"] =
    rawStatus === "complete" ||
    rawStatus === "completed" ||
    rawStatus === "ok" ||
    rawStatus === "succeeded" ||
    rawStatus === "success"
      ? "Complete"
      : rawStatus === "failed" || rawStatus === "error"
        ? "Failed"
        : rawStatus === "running"
          ? "Running"
          : rawStatus === "skipped" || rawStatus === "offline"
            ? "Offline"
            : "Queued";

  return {
    id: typeof data.id === "string"
      ? data.id
      : typeof nestedOperation.id === "string"
        ? nestedOperation.id
        : crypto.randomUUID(),
    title: typeof data.title === "string"
      ? data.title
      : typeof nestedOperation.type === "string"
        ? nestedOperation.type
      : typeof data.name === "string"
        ? data.name
        : fallbackTitle,
    status,
    detail: typeof data.detail === "string"
      ? data.detail
      : typeof nestedResult.summary === "string"
        ? nestedResult.summary
      : typeof data.message === "string"
        ? data.message
        : "Operation accepted by sidecar",
    createdAt: typeof data.createdAt === "string"
      ? data.createdAt
      : typeof data.timestamp === "string"
        ? data.timestamp
        : new Date().toLocaleTimeString()
  };
}

function unwrapOperation(value: unknown, fallbackTitle: string): OperationRecord {
  const data = asRecord(value);
  const nested = data.operation ?? data.data;
  return normalizeOperation(nested && typeof nested === "object" ? nested : data, fallbackTitle);
}

function unwrapOperations(value: unknown): OperationRecord[] {
  const data = asRecord(value);
  const rawOperations = Array.isArray(value)
    ? value
    : Array.isArray(data.operations)
      ? data.operations
      : Array.isArray(data.data)
        ? data.data
        : [];

  return rawOperations.map((operation) => normalizeOperation(operation, "Blender operation"));
}

export async function getSidecarHealth(): Promise<ApiResult<SidecarHealth>> {
  const result = await firstAvailable<unknown>(["/health", "/api/health", "/status"]);

  return {
    data: result.data ? normalizeHealth(result.data) : null,
    error: result.error,
    endpoint: result.endpoint
  };
}

export async function getSettings(): Promise<ApiResult<Partial<PipelineSettings>>> {
  const result = await requestJson<unknown>("/settings");

  return {
    data: result.data ? normalizeSettings(result.data) : null,
    error: result.error,
    endpoint: result.endpoint
  };
}

export async function saveSettings(settings: PipelineSettings): Promise<SidecarActionResult> {
  const result = await requestJson<unknown>("/settings", {
    method: "POST",
    body: JSON.stringify({ settings: toSidecarSettings(settings) })
  });

  if (!result.data) {
    return {
      ok: false,
      message: "Settings endpoint unavailable; edits are kept in the desktop session."
    };
  }

  const data = asRecord(result.data);
  const failure = readApiError(data);
  if (failure) {
    return {
      ok: false,
      message: failure,
      endpoint: result.endpoint,
      snapshot: unwrapSnapshot(data),
      operation: unwrapOperation(data, "Connect Blender")
    };
  }

  return {
    ok: true,
    message: typeof data.message === "string" ? data.message : "Settings saved",
    endpoint: result.endpoint
  };
}

export async function getSamplePipeline(): Promise<ApiResult<Partial<PipelineSnapshot>>> {
  const result = await firstAvailable<unknown>([
    "/pipeline/sample",
    "/project/demo",
    "/pipelines/sample",
    "/sample-pipeline",
    "/api/pipeline/sample",
    "/api/pipelines/sample"
  ]);

  return {
    data: result.data ? unwrapSnapshot(result.data) : null,
    error: result.error,
    endpoint: result.endpoint
  };
}

export async function connectBlender(settings: PipelineSettings): Promise<SidecarActionResult> {
  const result = await requestJson<unknown>("/blender/connect", {
    method: "POST",
    body: JSON.stringify({ source: "desktop", settings: toSidecarSettings(settings) })
  });

  if (!result.data) {
    return {
      ok: false,
      message: "Blender connect endpoint unavailable; static Blender state is still shown."
    };
  }

  const data = asRecord(result.data);
  const failure = readApiError(data);
  if (failure) {
    return {
      ok: false,
      message: failure,
      endpoint: result.endpoint,
      snapshot: unwrapSnapshot(data),
      operation: unwrapOperation(data, "Connect Blender")
    };
  }

  return {
    ok: true,
    message: typeof data.message === "string" ? data.message : "Blender connection requested",
    endpoint: result.endpoint,
    snapshot: unwrapSnapshot(data),
    operation: unwrapOperation(data, "Connect Blender")
  };
}

function toSidecarSettings(settings: PipelineSettings): Record<string, unknown> {
  return {
    models: {
      groqModel: settings.groqModel,
      openRouterModel: settings.openRouterModel
    },
    blender: {
      command: settings.blenderMcpCommand,
      args: settings.blenderMcpArgs.split(/\s+/).map((part) => part.trim()).filter(Boolean),
      autoConnect: settings.autoConnect
    },
    groq: {
      apiKey: settings.groqApiKey
    },
    openRouter: {
      apiKey: settings.openRouterApiKey
    }
  };
}

export async function listBlenderTools(): Promise<ApiResult<BlenderTool[]>> {
  const result = await requestJson<unknown>("/blender/tools");
  if (!result.data) {
    return {
      data: null,
      error: result.error,
      endpoint: result.endpoint
    };
  }

  const data = asRecord(result.data);
  const blender = asRecord(data.blender);
  if (data.fallback === true || blender.connected === false) {
    return {
      data: null,
      error: typeof data.error === "string" ? data.error : "Blender MCP is not connected",
      endpoint: result.endpoint
    };
  }

  return {
    data: unwrapTools(result.data),
    error: result.error,
    endpoint: result.endpoint
  };
}

export async function runBlenderOperation(request: BlenderOperationRequest): Promise<SidecarActionResult> {
  const args = asRecord(request.arguments);
  const operation = args.operation;
  const result = await requestJson<unknown>("/blender/operation", {
    method: "POST",
    body: JSON.stringify({
      source: "desktop",
      operation: operation && typeof operation === "object" ? operation : {
        type: request.tool,
        params: args
      }
    })
  });

  if (!result.data) {
    return {
      ok: false,
      message: "Blender operation endpoint unavailable; no scene changes were sent."
    };
  }

  const data = asRecord(result.data);
  const failure = readApiError(data);
  if (failure) {
    return {
      ok: false,
      message: failure,
      endpoint: result.endpoint,
      snapshot: unwrapSnapshot(data),
      operation: unwrapOperation(data, request.tool)
    };
  }

  return {
    ok: true,
    message: typeof data.message === "string" ? data.message : "Blender operation requested",
    endpoint: result.endpoint,
    snapshot: unwrapSnapshot(data),
    operation: unwrapOperation(data, request.tool)
  };
}

export async function runProductVizDemo(): Promise<SidecarActionResult> {
  const result = await requestJson<unknown>("/blender/demo/product-viz", {
    method: "POST",
    body: JSON.stringify({ source: "desktop" })
  });

  if (!result.data) {
    return {
      ok: false,
      message: "Product viz demo endpoint unavailable; no Blender operation was started."
    };
  }

  const data = asRecord(result.data);
  const failure = readApiError(data);
  if (failure) {
    return {
      ok: false,
      message: failure,
      endpoint: result.endpoint,
      snapshot: unwrapSnapshot(data),
      operation: unwrapOperation(data, "Product viz demo")
    };
  }

  return {
    ok: true,
    message: typeof data.message === "string" ? data.message : "Product viz demo requested",
    endpoint: result.endpoint,
    snapshot: unwrapSnapshot(data),
    operation: unwrapOperation(data, "Product viz demo")
  };
}

function normalizeAssetCandidate(value: unknown): AssetCandidate {
  const data = asRecord(value);
  const tagsValue = data.tags;
  const categoriesValue = data.categories;
  const metadata = asRecord(data.record ?? data.metadata);
  return {
    id: typeof data.id === "string" ? data.id : "",
    label: typeof data.label === "string" ? data.label : typeof data.name === "string" ? data.name : "",
    source: typeof data.source === "string" ? data.source : "unknown",
    kind: typeof data.kind === "string" ? data.kind : undefined,
    score: typeof data.score === "number" ? data.score : 0,
    reason: typeof data.reason === "string" ? data.reason : undefined,
    tags: Array.isArray(tagsValue) ? tagsValue.filter((tag): tag is string => typeof tag === "string") : undefined,
    categories: Array.isArray(categoriesValue)
      ? categoriesValue.filter((category): category is string => typeof category === "string")
      : undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined
  };
}

export async function searchAssets(body: {
  query?: string;
  kind?: string;
  tags?: string[];
  limit?: number;
}): Promise<AssetSearchResponse> {
  const result = await requestJson<unknown>("/assets/search", {
    method: "POST",
    body: JSON.stringify(body)
  });

  if (!result.data) {
    return {
      ok: false,
      candidates: [],
      error: result.error ?? "Asset search endpoint unavailable"
    };
  }

  const data = asRecord(result.data);
  const rawCandidates = Array.isArray(data.candidates)
    ? data.candidates
    : Array.isArray(result.data)
      ? (result.data as unknown[])
      : [];

  return {
    ok: data.ok === true,
    candidates: rawCandidates.map(normalizeAssetCandidate),
    error: typeof data.error === "string" ? data.error : undefined
  };
}

export type ImportPolyHavenAssetResponse = {
  ok: boolean;
  kind: string;
  slug: string;
  localPath?: string;
  message?: string;
  error?: string;
};

export async function importPolyHavenAsset(input: {
  id: string;
  kind: "hdri" | "material";
  resolution?: "1k" | "2k" | "4k";
}): Promise<ImportPolyHavenAssetResponse> {
  const endpoint = `${sidecarBaseUrl}/blender/import-asset`;
  const controller = new AbortController();
  // Asset downloads + Blender Python execution can comfortably exceed the
  // 2.5s default timeout used elsewhere; allow up to 60s.
  const timeout = window.setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        source: "polyhaven",
        id: input.id,
        kind: input.kind,
        resolution: input.resolution ?? "2k"
      }),
      signal: controller.signal
    });

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const data = asRecord(parsed);

    if (!response.ok || data.ok === false) {
      return {
        ok: false,
        kind: typeof data.kind === "string" ? data.kind : input.kind,
        slug: typeof data.slug === "string" ? data.slug : input.id,
        localPath: typeof data.localPath === "string" ? data.localPath : undefined,
        message: typeof data.message === "string" ? data.message : undefined,
        error:
          typeof data.error === "string"
            ? data.error
            : `${response.status} ${response.statusText}`
      };
    }

    return {
      ok: true,
      kind: typeof data.kind === "string" ? data.kind : input.kind,
      slug: typeof data.slug === "string" ? data.slug : input.id,
      localPath: typeof data.localPath === "string" ? data.localPath : undefined,
      message: typeof data.message === "string" ? data.message : undefined
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? "Asset import timed out"
          : error.message
        : "Asset import failed";
    return {
      ok: false,
      kind: input.kind,
      slug: input.id,
      error: message
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getRecentOperations(filter?: {
  projectId?: string;
}): Promise<ApiResult<OperationRecord[]>> {
  const params = new URLSearchParams();
  if (filter?.projectId) {
    params.set("projectId", filter.projectId);
  }
  const query = params.toString();
  const path = query.length > 0 ? `/operations/recent?${query}` : "/operations/recent";
  const result = await requestJson<unknown>(path);

  return {
    data: result.data ? unwrapOperations(result.data) : null,
    error: result.error,
    endpoint: result.endpoint
  };
}

export type PipelineRunStepResult = {
  stepId: string;
  lane: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  output?: unknown;
  error?: string;
};

export type PipelineRunRecord = {
  id: string;
  projectId: string | null;
  prompt?: string;
  definitionId: string;
  startedAt: string;
  completedAt: string;
  results: PipelineRunStepResult[];
};

export async function listPipelineRuns(filter?: {
  projectId?: string;
}): Promise<{ runs: PipelineRunRecord[] }> {
  const params = new URLSearchParams();
  if (filter?.projectId) {
    params.set("projectId", filter.projectId);
  }
  const query = params.toString();
  const path = query.length > 0 ? `/pipeline/runs?${query}` : "/pipeline/runs";
  return requestJsonOrThrow<{ runs: PipelineRunRecord[] }>(path);
}

export async function getPipelineRun(id: string): Promise<{ run: PipelineRunRecord }> {
  return requestJsonOrThrow<{ run: PipelineRunRecord }>(
    `/pipeline/runs/${encodeURIComponent(id)}`
  );
}

/**
 * Result of a DELETE /pipeline/runs/:id call. The sidecar maps to
 *   200 → run was running and is now cancelled
 *   404 → no run with that id (already disappeared or never existed)
 *   409 → run is already in a terminal state (completed/failed/cancelled)
 *
 * Network failures (sidecar unreachable, timeout, etc.) are surfaced as
 * `{ kind: "error", message }` so the caller can show a banner.
 */
export type CancelPipelineRunResult =
  | { kind: "cancelled" }
  | { kind: "not-found" }
  | { kind: "already-terminal" }
  | { kind: "error"; message: string };

export async function cancelPipelineRun(
  runId: string
): Promise<CancelPipelineRunResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const endpoint = `${sidecarBaseUrl}/pipeline/runs/${encodeURIComponent(runId)}`;

  try {
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (response.status === 200) {
      return { kind: "cancelled" };
    }
    if (response.status === 404) {
      return { kind: "not-found" };
    }
    if (response.status === 409) {
      return { kind: "already-terminal" };
    }
    return {
      kind: "error",
      message: `${response.status} ${response.statusText}`
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? "Cancel request timed out"
          : error.message
        : "Cancel request failed";
    return { kind: "error", message };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function syncBlender(): Promise<SidecarActionResult> {
  const result = await firstAvailable<unknown>(
    ["/blender/sync", "/api/blender/sync", "/sync/blender"],
    { method: "POST", body: JSON.stringify({ source: "desktop" }) }
  );

  if (result.data) {
    const data = asRecord(result.data);
    const failure = readApiError(data);
    if (failure) {
      return {
        ok: false,
        message: failure,
        endpoint: result.endpoint,
        snapshot: unwrapSnapshot(data)
      };
    }

    return {
      ok: true,
      message: typeof data.message === "string" ? data.message : "Blender sync requested",
      endpoint: result.endpoint,
      snapshot: unwrapSnapshot(data)
    };
  }

  const health = await getSidecarHealth();
  return {
    ok: Boolean(health.data?.ok),
    message: health.data?.ok ? "Sidecar is reachable; Blender sync endpoint was not exposed." : "Sidecar unavailable; using static Blender state.",
    endpoint: health.endpoint
  };
}

export type ProjectRecord = {
  id: string;
  name: string;
  description?: string;
  brief?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRecord = {
  id: string;
  projectId: string;
  kind: string;
  summary: string;
  status: "pending" | "approved" | "rejected";
  payload?: unknown;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
};

async function requestJsonOrThrow<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await requestJson<T>(path, init);
  if (!result.data) {
    throw new Error(result.error ?? `Sidecar request failed: ${path}`);
  }
  const failure = readApiError(asRecord(result.data));
  if (failure) {
    throw new Error(failure);
  }
  return result.data;
}

export async function listProjects(): Promise<{ projects: ProjectRecord[]; activeProjectId: string | null }> {
  return requestJsonOrThrow<{ projects: ProjectRecord[]; activeProjectId: string | null }>("/projects");
}

export async function createProject(input: {
  name: string;
  description?: string;
  brief?: string;
}): Promise<{ project: ProjectRecord }> {
  return requestJsonOrThrow<{ project: ProjectRecord }>("/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getProject(id: string): Promise<{ project: ProjectRecord }> {
  return requestJsonOrThrow<{ project: ProjectRecord }>(`/projects/${encodeURIComponent(id)}`);
}

export async function updateProject(
  id: string,
  patch: { name?: string; description?: string; brief?: string }
): Promise<{ project: ProjectRecord }> {
  return requestJsonOrThrow<{ project: ProjectRecord }>(`/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export async function deleteProject(id: string): Promise<{ ok: boolean }> {
  return requestJsonOrThrow<{ ok: boolean }>(`/projects/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function setActiveProject(
  id: string | null
): Promise<{ ok: boolean; activeProjectId: string | null }> {
  return requestJsonOrThrow<{ ok: boolean; activeProjectId: string | null }>("/projects/active", {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export async function listApprovals(filter?: {
  projectId?: string;
  status?: "pending" | "approved" | "rejected";
}): Promise<{ approvals: ApprovalRecord[] }> {
  const params = new URLSearchParams();
  if (filter?.projectId) {
    params.set("projectId", filter.projectId);
  }
  if (filter?.status) {
    params.set("status", filter.status);
  }
  const query = params.toString();
  const path = query.length > 0 ? `/approvals?${query}` : "/approvals";
  return requestJsonOrThrow<{ approvals: ApprovalRecord[] }>(path);
}

export async function createApproval(input: {
  projectId: string;
  kind: string;
  summary: string;
  payload?: unknown;
}): Promise<{ approval: ApprovalRecord }> {
  return requestJsonOrThrow<{ approval: ApprovalRecord }>("/approvals", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function decideApproval(
  id: string,
  body: { status: "approved" | "rejected"; reason?: string; decidedBy?: string }
): Promise<{ approval: ApprovalRecord }> {
  return requestJsonOrThrow<{ approval: ApprovalRecord }>(
    `/approvals/${encodeURIComponent(id)}/decide`,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}

export async function runSamplePlanner(): Promise<SidecarActionResult> {
  const result = await firstAvailable<unknown>(
    [
      "/pipeline/sample/run",
      "/pipeline/run",
      "/pipelines/sample/run",
      "/planner/run",
      "/api/pipeline/sample/run",
      "/api/planner/run"
    ],
    { method: "POST", body: JSON.stringify({ pipeline: "sample", source: "desktop" }) }
  );

  if (!result.data) {
    return {
      ok: false,
      message: "Planner endpoint unavailable; static pipeline data is still shown."
    };
  }

  const data = asRecord(result.data);
  const failure = readApiError(data);
  if (failure) {
    return {
      ok: false,
      message: failure,
      endpoint: result.endpoint,
      snapshot: unwrapSnapshot(data)
    };
  }

  return {
    ok: true,
    message: typeof data.message === "string" ? data.message : "Sample planner run requested",
    endpoint: result.endpoint,
    snapshot: unwrapSnapshot(data)
  };
}

// ---------------------------------------------------------------------------
// Async pipeline submission (POST /pipeline/runs)
// ---------------------------------------------------------------------------

export type PipelineDefinitionPayload = {
  id: string;
  input: unknown;
  steps: ReadonlyArray<{
    id: string;
    lane: string;
    instruction: string;
    dependsOn?: readonly string[];
    metadata?: Record<string, unknown>;
  }>;
};

export type PipelineRunBody =
  | { prompt: string }
  | { pipeline: "sample" }
  | PipelineDefinitionPayload;

export type PipelineRunSubmitResponse = {
  runId: string;
  status: string;
  runUrl: string;
  eventsUrl: string;
};

export async function runPipelineAsync(
  body: PipelineRunBody,
  opts?: { projectId?: string }
): Promise<PipelineRunSubmitResponse> {
  const payload: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  if (opts?.projectId) {
    payload.projectId = opts.projectId;
  }
  const data = await requestJsonOrThrow<unknown>("/pipeline/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const record = asRecord(data);
  const runId = typeof record.runId === "string" ? record.runId : "";
  if (!runId) {
    throw new Error("Pipeline run submission missing runId");
  }
  return {
    runId,
    status: typeof record.status === "string" ? record.status : "running",
    runUrl: typeof record.runUrl === "string" ? record.runUrl : `/pipeline/runs/${runId}`,
    eventsUrl:
      typeof record.eventsUrl === "string"
        ? record.eventsUrl
        : `/events?runId=${encodeURIComponent(runId)}`
  };
}

// ---------------------------------------------------------------------------
// Live Blender scene state (GET /blender/scene-info)
// ---------------------------------------------------------------------------

export interface SceneInfoResponse {
  ok: boolean;
  connected: boolean;
  scene: {
    sceneName: string;
    engine: string;
    frame: { current: number; start: number; end: number };
    objects: { type: string; count: number }[];
    activeCameraName: string | null;
    materials: { name: string }[];
    raw: unknown;
  } | null;
  fetchedAt: string;
  error?: string;
}

const SCENE_INFO_TIMEOUT_MS = 8000;

/**
 * Polls the sidecar for the live Blender scene snapshot. The sidecar returns
 * 200 with `{ ok: false, connected: false, scene: null }` while Blender is
 * offline; this helper returns that payload as-is so the panel can render a
 * "not connected" empty state without treating it as an error.
 *
 * Throws when the network is unreachable or the response cannot be parsed —
 * callers should treat those as transient failures.
 */
export async function getSceneInfo(): Promise<SceneInfoResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SCENE_INFO_TIMEOUT_MS);
  const endpoint = `${sidecarBaseUrl}/blender/scene-info`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as unknown;
    return normalizeSceneInfo(json);
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeSceneInfo(value: unknown): SceneInfoResponse {
  const data = asRecord(value);
  const connected = data.connected === true;
  const sceneRaw = data.scene;
  const fetchedAt = typeof data.fetchedAt === "string" ? data.fetchedAt : new Date().toISOString();
  const error = typeof data.error === "string" ? data.error : undefined;

  let scene: SceneInfoResponse["scene"] = null;
  if (sceneRaw && typeof sceneRaw === "object") {
    const s = sceneRaw as Record<string, unknown>;
    const frameRaw = asRecord(s.frame);
    const objectsRaw = Array.isArray(s.objects) ? s.objects : [];
    const materialsRaw = Array.isArray(s.materials) ? s.materials : [];
    scene = {
      sceneName: typeof s.sceneName === "string" ? s.sceneName : "Untitled scene",
      engine: typeof s.engine === "string" ? s.engine : "UNKNOWN",
      frame: {
        current: typeof frameRaw.current === "number" ? frameRaw.current : 0,
        start: typeof frameRaw.start === "number" ? frameRaw.start : 1,
        end: typeof frameRaw.end === "number" ? frameRaw.end : 250
      },
      objects: objectsRaw
        .map((entry) => {
          const obj = asRecord(entry);
          if (typeof obj.type !== "string" || typeof obj.count !== "number") {
            return null;
          }
          return { type: obj.type, count: obj.count };
        })
        .filter((entry): entry is { type: string; count: number } => entry !== null),
      activeCameraName: typeof s.activeCameraName === "string" ? s.activeCameraName : null,
      materials: materialsRaw
        .map((entry) => {
          const obj = asRecord(entry);
          if (typeof obj.name !== "string") {
            return null;
          }
          return { name: obj.name };
        })
        .filter((entry): entry is { name: string } => entry !== null),
      raw: s.raw ?? null
    };
  }

  return {
    ok: data.ok === true,
    connected,
    scene,
    fetchedAt,
    ...(error ? { error } : {})
  };
}
