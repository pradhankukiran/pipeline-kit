import { createContext, useContext } from "react";
import type {
  OperationRecord,
  PipelineSettings,
  PipelineSnapshot
} from "./fallbackData";
import type { UpdateInfo } from "./lib/updater";
import type {
  BlenderTool,
  ProjectRecord,
  SidecarHealth
} from "./sidecarApi";

export type ActionState = {
  sync: boolean;
  planner: boolean;
  saveSettings: boolean;
  connect: boolean;
  tools: boolean;
  demo: boolean;
};

export type BlenderOpId =
  | "create_scene"
  | "create_studio_set"
  | "apply_material"
  | "create_lighting_rig"
  | "create_camera_rig"
  | "render_shot"
  | "inspect_scene"
  | "save_checkpoint";

export type QuickOp = {
  id: BlenderOpId;
  label: string;
  blurb: string;
  defaultParams: Record<string, unknown>;
};

export type OpRunState = {
  status: "idle" | "running" | "ok" | "failed";
  summary?: string;
};

export type OpStateMap = Record<BlenderOpId, OpRunState>;

export type BlenderSessionView = {
  title: string;
  scene: string;
  connected: boolean;
};

export type ApiStatus = SidecarHealth;

export interface DashboardContextValue {
  // Snapshot fallback
  snapshot: PipelineSnapshot;

  // Projects
  projects: ProjectRecord[];
  projectsLoading: boolean;
  projectsError: string | null;
  activeProjectId: string | null;

  // Project actions
  handleCreateProject: (name: string) => Promise<void>;
  handleSelectProject: (id: string) => Promise<void>;
  handleExportProject: () => Promise<void>;
  handleImportProject: (bundle: object) => Promise<void>;
  exportingProject: boolean;
  importingProject: boolean;

  // Sidecar
  health: ApiStatus | null;
  loading: boolean;
  error: string | null;
  message: string | null;
  sidecarUrl: string;

  // Settings
  settings: PipelineSettings;
  autoConnect: boolean;
  setAutoConnect: (value: boolean) => void;
  updateSetting: (field: keyof PipelineSettings, value: string) => void;
  handleSaveSettings: () => Promise<void>;

  // Settings modal
  settingsOpen: boolean;
  setSettingsOpen: (value: boolean) => void;

  // Blender
  blenderSession: BlenderSessionView;
  tools: BlenderTool[];
  actions: ActionState;
  handleConnectBlender: () => Promise<void>;
  handleListTools: () => Promise<void>;
  handleRunProductVizDemo: () => Promise<void>;
  handleRunQuickOp: (op: QuickOp) => Promise<void>;
  opStates: OpStateMap;
  QUICK_OPS: QuickOp[];

  // Operations
  operations: OperationRecord[];
  opsScopeActive: boolean;
  setOpsScopeActive: (value: boolean) => void;

  // Banners + approvals
  submitBanner: string | null;
  setSubmitBanner: (value: string | null) => void;
  approvalsRefreshTick: number;

  // Updater
  availableUpdate: UpdateInfo | null;
  setAvailableUpdate: (value: UpdateInfo | null) => void;

  // High-level actions
  handleSyncBlender: () => Promise<void>;
  handleRunPlanner: () => Promise<void>;
}

export const DashboardContext = createContext<DashboardContextValue | undefined>(
  undefined
);

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error(
      "useDashboard must be used inside a DashboardContext.Provider"
    );
  }
  return ctx;
}
