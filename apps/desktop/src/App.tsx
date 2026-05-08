import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { SettingsPanel } from "@/components/panels/SettingsPanel";
import {
  DashboardContext,
  type DashboardContextValue,
  type OpStateMap,
  type QuickOp
} from "./dashboard-context";
import { Layout } from "./layouts/Layout";
import { ProjectLayout } from "./layouts/ProjectLayout";
import { AssetsPage } from "./views/AssetsPage";
import { BlenderPage } from "./views/BlenderPage";
import { OverviewPage } from "./views/OverviewPage";
import { ReviewPage } from "./views/ReviewPage";
import { RunsPage } from "./views/RunsPage";
import { WelcomePage } from "./views/WelcomePage";
import {
  fallbackOperations,
  fallbackSettings,
  fallbackSnapshot,
  type OperationRecord,
  type PipelineSettings,
  type PipelineSnapshot
} from "./fallbackData";
import {
  connectBlender,
  createProject,
  getSamplePipeline,
  getRecentOperations,
  getSettings,
  getSidecarHealth,
  listBlenderTools,
  listProjects,
  runBlenderOperation,
  runPipelineAsync,
  saveSettings,
  setActiveProject,
  sidecarBaseUrl,
  syncBlender,
  type BlenderTool,
  type ProjectRecord,
  type SidecarHealth
} from "./sidecarApi";
import { subscribeAll } from "./eventStream";

type ActionState = {
  sync: boolean;
  planner: boolean;
  saveSettings: boolean;
  connect: boolean;
  tools: boolean;
  demo: boolean;
};

type SettingsField = keyof PipelineSettings;

const QUICK_OPS: QuickOp[] = [
  {
    id: "create_scene",
    label: "Create Scene",
    blurb: "Initialize a new Blender scene with metric units.",
    defaultParams: { units: "metric", clearExisting: true }
  },
  {
    id: "create_studio_set",
    label: "Studio Set",
    blurb: "Instantiate a preset studio recipe (white sweep, softbox, turntable).",
    defaultParams: { recipeId: "water_bottle_product_viz" }
  },
  {
    id: "apply_material",
    label: "Apply Material",
    blurb: "Assign a procedural material to the active object.",
    defaultParams: { target: "Subject", materialId: "matte-clay" }
  },
  {
    id: "create_lighting_rig",
    label: "Lighting Rig",
    blurb: "Build a softbox three-point lighting setup.",
    defaultParams: { recipeId: "softbox-three-point", hdri: null }
  },
  {
    id: "create_camera_rig",
    label: "Camera Rig",
    blurb: "Place a turntable orbit camera around the subject.",
    defaultParams: { recipeId: "turntable-orbit", focalLength: 50 }
  },
  {
    id: "render_shot",
    label: "Render Shot",
    blurb: "Render the current shot at preview quality.",
    defaultParams: { quality: "preview", label: "preview" }
  },
  {
    id: "inspect_scene",
    label: "Inspect Scene",
    blurb: "Dump objects, materials, and render settings.",
    defaultParams: {}
  },
  {
    id: "save_checkpoint",
    label: "Save Checkpoint",
    blurb: "Persist a labeled checkpoint with the current scene.",
    defaultParams: { label: "auto-checkpoint", saveBlend: true }
  }
];

function createInitialOpState(): OpStateMap {
  return QUICK_OPS.reduce<OpStateMap>((acc, op) => {
    acc[op.id] = { status: "idle" };
    return acc;
  }, {} as OpStateMap);
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function mergeSnapshot(current: PipelineSnapshot, next: Partial<PipelineSnapshot> | null): PipelineSnapshot {
  if (!next) {
    return current;
  }

  return {
    ...current,
    ...next,
    navItems: next.navItems?.length ? next.navItems : current.navItems,
    metrics: { ...current.metrics, ...next.metrics },
    projects: next.projects?.length ? next.projects : current.projects,
    brief: next.brief?.length ? next.brief : current.brief,
    board: next.board?.length ? next.board : current.board,
    blenderSession: { ...current.blenderSession, ...next.blenderSession },
    assets: next.assets?.length ? next.assets : current.assets,
    shots: next.shots?.length ? next.shots : current.shots,
    reviewNotes: next.reviewNotes?.length ? next.reviewNotes : current.reviewNotes
  };
}

function addOperation(current: OperationRecord[], operation: OperationRecord): OperationRecord[] {
  return [operation, ...current.filter((item) => item.id !== operation.id)].slice(0, 8);
}

export function App() {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<PipelineSnapshot>(fallbackSnapshot);
  const [health, setHealth] = useState<SidecarHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>("Loading local sidecar state");
  const [settings, setSettings] = useState<PipelineSettings>(fallbackSettings);
  const [autoConnect, setAutoConnect] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tools, setTools] = useState<BlenderTool[]>([]);
  const [operations, setOperations] = useState<OperationRecord[]>(fallbackOperations);
  const [actions, setActions] = useState<ActionState>({
    sync: false,
    planner: false,
    saveSettings: false,
    connect: false,
    tools: false,
    demo: false
  });
  const [opStates, setOpStates] = useState<OpStateMap>(createInitialOpState);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [opsScopeActive, setOpsScopeActive] = useState(true);
  const [, setLastSubmittedRunId] = useState<string | null>(null);
  const [submitBanner, setSubmitBanner] = useState<string | null>(null);
  const [approvalsRefreshTick, setApprovalsRefreshTick] = useState(0);

  const refreshProjects = useCallback(async (): Promise<{
    projects: ProjectRecord[];
    activeProjectId: string | null;
  } | null> => {
    setProjectsLoading(true);
    try {
      const data = await listProjects();
      setProjects(data.projects);
      setActiveProjectIdState(data.activeProjectId);
      setProjectsError(null);
      return data;
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Could not load projects");
      return null;
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const handleSelectProject = useCallback(async (id: string) => {
    setActiveProjectIdState(id);
    try {
      await setActiveProject(id);
      setProjectsError(null);
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Could not set active project");
    }
  }, []);

  const handleCreateProject = useCallback(
    async (name: string) => {
      const { project } = await createProject({ name });
      await refreshProjects();
      setActiveProjectIdState(project.id);
      try {
        await setActiveProject(project.id);
      } catch {
        // server-side activation can fail silently; local state already reflects selection
      }
      navigate(`/projects/${project.id}/overview`);
    },
    [refreshProjects, navigate]
  );

  const loadSidecarState = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [healthResult, pipelineResult, settingsResult, operationsResult] = await Promise.all([
      getSidecarHealth(),
      getSamplePipeline(),
      getSettings(),
      getRecentOperations()
    ]);

    if (healthResult.data) {
      setHealth(healthResult.data);
    }

    if (pipelineResult.data) {
      setSnapshot((current) => mergeSnapshot(current, pipelineResult.data));
    }

    if (settingsResult.data) {
      setSettings((current) => ({ ...current, ...settingsResult.data }));
    }

    if (operationsResult.data?.length) {
      setOperations(operationsResult.data);
    }

    const nextError = healthResult.error && pipelineResult.error
      ? `Sidecar unavailable at ${sidecarBaseUrl}`
      : null;

    setError(nextError);
    setMessage(
      pipelineResult.data
        ? "Sample pipeline loaded from sidecar"
        : healthResult.data?.message ?? "Using bundled fallback production data"
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSidecarState();
  }, [loadSidecarState]);

  const refreshOperations = useCallback(async () => {
    const filter =
      opsScopeActive && activeProjectId ? { projectId: activeProjectId } : undefined;
    const result = await getRecentOperations(filter);
    if (result.data) {
      setOperations(result.data);
    }
  }, [opsScopeActive, activeProjectId]);

  useEffect(() => {
    void refreshOperations();
  }, [refreshOperations]);

  // Global SSE: any step.started carrying requiresApproval triggers an
  // approvals refresh tick. Errors silently drop the subscription —
  // ReviewPanel keeps its own refresh button + tab-switch refresh.
  useEffect(() => {
    const sub = subscribeAll({
      onStepStarted: (event) => {
        const meta = event.step.metadata;
        if (meta && (meta as Record<string, unknown>)["requiresApproval"] === true) {
          setApprovalsRefreshTick((current) => current + 1);
        }
      },
      onError: () => {
        sub.close();
      }
    });
    return () => {
      sub.close();
    };
  }, []);

  const blenderSession = useMemo(() => {
    if (!health?.blender) {
      return snapshot.blenderSession;
    }

    return {
      title: [health.blender.version ?? "Blender", "MCP bridge"].join(" / "),
      scene: health.blender.scene ? `Scene: ${health.blender.scene}` : snapshot.blenderSession.scene,
      connected: health.blender.connected ?? snapshot.blenderSession.connected
    };
  }, [health, snapshot.blenderSession]);

  const handleSyncBlender = useCallback(async () => {
    setActions((current) => ({ ...current, sync: true }));
    setError(null);
    setMessage("Checking Blender bridge");

    const result = await syncBlender();
    if (result.snapshot) {
      setSnapshot((current) => mergeSnapshot(current, result.snapshot ?? null));
    }

    const healthResult = await getSidecarHealth();
    if (healthResult.data) {
      setHealth(healthResult.data);
    }

    setMessage(result.message);
    setError(result.ok ? null : result.message);
    setActions((current) => ({ ...current, sync: false }));
  }, []);

  const handleRunPlanner = useCallback(async () => {
    setActions((current) => ({ ...current, planner: true }));
    setError(null);
    setMessage("Submitting sample planner run");

    try {
      const submission = await runPipelineAsync(
        { pipeline: "sample" },
        activeProjectId ? { projectId: activeProjectId } : undefined
      );
      setLastSubmittedRunId(submission.runId);
      const shortId = submission.runId.slice(0, 8);
      const banner = `Submitted run ${shortId} · view in Pipeline Runs`;
      setSubmitBanner(banner);
      setMessage(banner);
      setError(null);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Failed to submit pipeline run";
      setMessage(reason);
      setError(reason);
      setSubmitBanner(null);
    } finally {
      setActions((current) => ({ ...current, planner: false }));
    }
  }, [activeProjectId]);

  const updateSetting = useCallback((field: SettingsField, value: string) => {
    setSettings((current) => ({ ...current, [field]: value }));
  }, []);

  const handleSaveSettings = useCallback(async () => {
    setActions((current) => ({ ...current, saveSettings: true }));
    setError(null);
    setMessage("Saving desktop settings");

    const result = await saveSettings(settings);
    setMessage(result.message);
    setError(result.ok ? null : result.message);
    setActions((current) => ({ ...current, saveSettings: false }));
  }, [settings]);

  const handleConnectBlender = useCallback(async () => {
    setActions((current) => ({ ...current, connect: true }));
    setError(null);
    setMessage("Connecting Blender MCP bridge");

    const result = await connectBlender(settings);
    if (result.snapshot) {
      setSnapshot((current) => mergeSnapshot(current, result.snapshot ?? null));
    }
    if (result.operation) {
      setOperations((current) => addOperation(current, result.operation as OperationRecord));
    }

    const healthResult = await getSidecarHealth();
    if (healthResult.data) {
      setHealth(healthResult.data);
    }

    setMessage(result.message);
    setError(result.ok ? null : result.message);
    setActions((current) => ({ ...current, connect: false }));
  }, [settings]);

  const handleListTools = useCallback(async () => {
    setActions((current) => ({ ...current, tools: true }));
    setError(null);
    setMessage("Listing Blender MCP tools");

    const result = await listBlenderTools();
    if (result.data) {
      setTools(result.data);
    }

    setMessage(result.data ? `Loaded ${result.data.length} Blender tools` : "Blender tools endpoint unavailable; static UI remains active.");
    setError(result.data ? null : result.error ?? "Blender tools endpoint unavailable");
    setActions((current) => ({ ...current, tools: false }));
  }, []);

  const handleRunProductVizDemo = useCallback(async () => {
    setActions((current) => ({ ...current, demo: true }));
    setError(null);
    setMessage("Submitting product viz pipeline run");

    try {
      const submission = await runPipelineAsync(
        { prompt: "Run the product viz demo: stage a water bottle for product photography." },
        activeProjectId ? { projectId: activeProjectId } : undefined
      );
      setLastSubmittedRunId(submission.runId);
      const shortId = submission.runId.slice(0, 8);
      const banner = `Submitted run ${shortId} · view in Pipeline Runs`;
      setSubmitBanner(banner);
      setMessage(banner);
      setError(null);
      await refreshOperations();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Failed to submit product viz pipeline run";
      setMessage(reason);
      setError(reason);
      setSubmitBanner(null);
    } finally {
      setActions((current) => ({ ...current, demo: false }));
    }
  }, [activeProjectId, refreshOperations]);

  const handleRunQuickOp = useCallback(async (op: QuickOp) => {
    setOpStates((current) => ({ ...current, [op.id]: { status: "running" } }));

    const result = await runBlenderOperation({
      tool: op.id,
      arguments: {
        operation: {
          id: crypto.randomUUID(),
          type: op.id,
          params: op.defaultParams,
          requiresApproval: false
        }
      }
    });

    if (result.ok) {
      const detail = result.operation?.detail ?? result.message;
      setOpStates((current) => ({
        ...current,
        [op.id]: { status: "ok", summary: truncate(detail) }
      }));
      if (result.operation) {
        setOperations((existing) => addOperation(existing, result.operation as OperationRecord));
      }
    } else {
      setOpStates((current) => ({
        ...current,
        [op.id]: { status: "failed", summary: truncate(result.message) }
      }));
    }
  }, []);

  const contextValue = useMemo<DashboardContextValue>(
    () => ({
      snapshot,
      projects,
      projectsLoading,
      projectsError,
      activeProjectId,
      handleCreateProject,
      handleSelectProject,
      health,
      loading,
      error,
      message,
      sidecarUrl: sidecarBaseUrl,
      settings,
      autoConnect,
      setAutoConnect,
      updateSetting,
      handleSaveSettings,
      settingsOpen,
      setSettingsOpen,
      blenderSession,
      tools,
      actions,
      handleConnectBlender,
      handleListTools,
      handleRunProductVizDemo,
      handleRunQuickOp,
      opStates,
      QUICK_OPS,
      operations,
      opsScopeActive,
      setOpsScopeActive,
      submitBanner,
      setSubmitBanner,
      approvalsRefreshTick,
      handleSyncBlender,
      handleRunPlanner
    }),
    [
      snapshot,
      projects,
      projectsLoading,
      projectsError,
      activeProjectId,
      handleCreateProject,
      handleSelectProject,
      health,
      loading,
      error,
      message,
      settings,
      autoConnect,
      updateSetting,
      handleSaveSettings,
      settingsOpen,
      blenderSession,
      tools,
      actions,
      handleConnectBlender,
      handleListTools,
      handleRunProductVizDemo,
      handleRunQuickOp,
      opStates,
      operations,
      opsScopeActive,
      submitBanner,
      approvalsRefreshTick,
      handleSyncBlender,
      handleRunPlanner
    ]
  );

  return (
    <DashboardContext.Provider value={contextValue}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<WelcomePage />} />
          <Route path="welcome" element={<Navigate to="/" replace />} />
        </Route>
        <Route path="projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="blender" element={<BlenderPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="assets" element={<AssetsPage />} />
        </Route>
      </Routes>

      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        saving={actions.saveSettings}
        disabled={loading}
        autoConnect={autoConnect}
        onAutoConnectChange={setAutoConnect}
        onChange={updateSetting}
        onSave={handleSaveSettings}
      />
    </DashboardContext.Provider>
  );
}
