export type NavItem = {
  id: string;
  label: string;
  meta: string;
};

export type Project = {
  name: string;
  client: string;
  status: "Active" | "At Risk" | "Review";
  due: string;
  progress: number;
  shots: string;
};

export type BoardItem = {
  title: string;
  owner: string;
  status: string;
  lane: string;
};

export type Asset = {
  name: string;
  kind: string;
  source: string;
  state: string;
};

export type Shot = [code: string, name: string, stage: string, length: string, state: string];

export type BriefItem = {
  label: string;
  value: string;
};

export type BlenderSession = {
  title: string;
  scene: string;
  connected: boolean;
};

export type ProductionMetrics = {
  progress: string;
  blockers: string;
  assets: string;
  review: string;
};

export type PipelineSettings = {
  blenderMcpCommand: string;
  blenderMcpArgs: string;
  autoConnect: boolean;
  groqModel: string;
  groqApiKey: string;
  openRouterModel: string;
  openRouterApiKey: string;
};

export type OperationRecord = {
  id: string;
  title: string;
  status: "Queued" | "Running" | "Complete" | "Failed" | "Offline";
  detail: string;
  createdAt: string;
};

export type PipelineSnapshot = {
  currentProject: string;
  navItems: NavItem[];
  metrics: ProductionMetrics;
  projects: Project[];
  brief: BriefItem[];
  board: BoardItem[];
  blenderSession: BlenderSession;
  assets: Asset[];
  shots: Shot[];
  reviewNotes: string[];
};

export const fallbackSettings: PipelineSettings = {
  blenderMcpCommand: "blender-socket",
  blenderMcpArgs: "",
  autoConnect: false,
  groqModel: "llama-3.3-70b-versatile",
  groqApiKey: "",
  openRouterModel: "anthropic/claude-3.5-sonnet",
  openRouterApiKey: ""
};

export const fallbackOperations: OperationRecord[] = [];

export const fallbackSnapshot: PipelineSnapshot = {
  currentProject: "",
  navItems: [
    { id: "projects", label: "Projects", meta: "0 live" },
    { id: "brief", label: "Brief", meta: "empty" },
    { id: "production", label: "Production Board", meta: "empty" },
    { id: "blender", label: "Blender Session", meta: "not connected" },
    { id: "assets", label: "Assets", meta: "ready" },
    { id: "shots", label: "Shot Board", meta: "empty" },
    { id: "review", label: "Review", meta: "0 notes" },
    { id: "settings", label: "Settings", meta: "local" },
    { id: "operations", label: "Operations", meta: "recent" }
  ],
  metrics: {
    progress: "0%",
    blockers: "0",
    assets: "0",
    review: "0"
  },
  projects: [],
  brief: [],
  board: [],
  blenderSession: {
    title: "Blender",
    scene: "No live Blender scene",
    connected: false
  },
  assets: [],
  shots: [],
  reviewNotes: []
};
