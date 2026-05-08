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
  blenderMcpCommand: "uvx",
  blenderMcpArgs: "blender-mcp",
  groqModel: "llama-3.3-70b-versatile",
  groqApiKey: "",
  openRouterModel: "anthropic/claude-3.5-sonnet",
  openRouterApiKey: ""
};

export const fallbackOperations: OperationRecord[] = [
  {
    id: "offline-product-viz",
    title: "Product viz demo",
    status: "Offline",
    detail: "Ready to run when the sidecar is available.",
    createdAt: "Local fallback"
  },
  {
    id: "offline-tools",
    title: "Blender tool catalog",
    status: "Offline",
    detail: "Tool listing will populate from /blender/tools.",
    createdAt: "Local fallback"
  }
];

export const fallbackSnapshot: PipelineSnapshot = {
  currentProject: "Orbital Foundry",
  navItems: [
    { id: "projects", label: "Projects", meta: "4 live" },
    { id: "brief", label: "Brief", meta: "locked v3" },
    { id: "production", label: "Production Board", meta: "16 tasks" },
    { id: "blender", label: "Blender Session", meta: "connected" },
    { id: "assets", label: "Assets", meta: "138 items" },
    { id: "shots", label: "Shot Board", meta: "42 shots" },
    { id: "review", label: "Review", meta: "9 notes" },
    { id: "settings", label: "Settings", meta: "local" },
    { id: "operations", label: "Operations", meta: "recent" }
  ],
  metrics: {
    progress: "72%",
    blockers: "4",
    assets: "138",
    review: "9 notes"
  },
  projects: [
    { name: "Orbital Foundry", client: "Aster Labs", status: "Active", due: "May 24", progress: 72, shots: "18/24" },
    { name: "Harbor Drift", client: "Northline", status: "Review", due: "May 17", progress: 88, shots: "31/36" },
    { name: "Desert Relay", client: "Atlas Film", status: "At Risk", due: "Jun 04", progress: 46, shots: "11/28" }
  ],
  brief: [
    { label: "Look", value: "Hard-surface industrial, grounded scale, practical lighting." },
    { label: "Delivery", value: "UHD review movie, Blender archive, asset manifest." },
    { label: "Guardrails", value: "No cloud execution, keep generated geometry editable." }
  ],
  board: [
    { title: "Resolve cockpit proxy scale", owner: "Maya", status: "Needs artist", lane: "Layout" },
    { title: "Generate station truss variants", owner: "Codex", status: "Queued", lane: "Assets" },
    { title: "Bake low-orbit lighting rig", owner: "Ravi", status: "In Blender", lane: "Lookdev" },
    { title: "Conform review notes R2", owner: "Nina", status: "Blocked", lane: "Editorial" },
    { title: "Validate Poly Haven material paths", owner: "Sidecar", status: "Running", lane: "Ingest" }
  ],
  blenderSession: {
    title: "Blender 4.1 / MCP bridge",
    scene: "Scene: foundry_master_v18.blend",
    connected: true
  },
  assets: [
    { name: "procedural_hangar_wall.blend", kind: "Recipe", source: "packages/recipes", state: "Ready" },
    { name: "industrial_floor_02", kind: "Material", source: "Poly Haven", state: "Syncing" },
    { name: "inspection_drone_v12.blend", kind: "Model", source: "Local Library", state: "Needs tags" },
    { name: "thruster_glow.comp", kind: "Compositor", source: "Project", state: "Ready" }
  ],
  shots: [
    ["SH010", "Docking reveal", "Layout", "1:00", "OK"],
    ["SH020", "Interior handoff", "Animation", "0:12", "Fix scale"],
    ["SH030", "Foundry flyover", "Lighting", "0:08", "Review"],
    ["SH040", "Drone inspection", "Sim", "0:15", "Queued"],
    ["SH050", "Client end card", "Comp", "0:05", "Locked"]
  ],
  reviewNotes: [
    "SH020 camera drift still visible after frame 124.",
    "Use colder fill on foundry gantry, match brief reference B.",
    "Replace temporary hull decals before client export.",
    "Confirm final slate naming with delivery preset."
  ]
};
