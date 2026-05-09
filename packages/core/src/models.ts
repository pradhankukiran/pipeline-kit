export type ID = string;

export type ModelLane = "groq" | "openrouter" | "codex";

export type PipelineStage =
  | "brief"
  | "direction"
  | "scene"
  | "assets"
  | "materials"
  | "lighting"
  | "cameras"
  | "render"
  | "review"
  | "revision"
  | "delivery";

export type TaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "needs_approval"
  | "completed"
  | "failed";

export type AssetSourceKind = "procedural" | "polyhaven" | "local";

export type AssetKind =
  | "model"
  | "material"
  | "texture"
  | "hdri"
  | "scene"
  | "rig"
  | "recipe";

export type CreativeBrief = {
  id: ID;
  projectId: ID;
  title: string;
  product: string;
  brand?: string;
  audience?: string;
  mood: string[];
  constraints: string[];
  deliverables: Deliverable[];
  references: ReferenceInput[];
  createdAt: string;
  updatedAt: string;
};

export type Deliverable = {
  id: ID;
  kind: "still" | "turntable" | "animation" | "contact_sheet" | "blend_file";
  label: string;
  format: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type ReferenceInput = {
  id: ID;
  kind: "image" | "url" | "text" | "file";
  label: string;
  value: string;
};

export type Project = {
  id: ID;
  name: string;
  workspacePath?: string;
  status?: "draft" | "active" | "archived";
  activeStage?: PipelineStage;
  description?: string;
  brief?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Terminal states for an Approval record.
 *
 *   - "pending"   — awaiting a human (or system) decision.
 *   - "approved"  — explicitly green-lit, usually by a user clicking Approve.
 *   - "rejected"  — explicitly denied, usually by a user clicking Reject.
 *   - "cancelled" — auto-set by the sidecar when the surrounding pipeline run
 *                   is cancelled while the approval is still pending. Distinct
 *                   from "rejected" because the user did not choose to deny;
 *                   the run was simply aborted out from under the gate.
 */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type Approval = {
  id: ID;
  projectId: ID;
  kind: string;
  summary: string;
  status: ApprovalStatus;
  payload?: unknown;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
};

export type StyleGuide = {
  id: ID;
  projectId: ID;
  palette: string[];
  materials: string[];
  lightingLanguage: string;
  cameraLanguage: string;
  negativeConstraints: string[];
};

export type ProductionTask = {
  id: ID;
  projectId: ID;
  stage: PipelineStage;
  title: string;
  description: string;
  status: TaskStatus;
  assignedLane: ModelLane;
  dependsOn: ID[];
  operationIds: ID[];
  createdAt: string;
  updatedAt: string;
};

export type AssetRecord = {
  id: ID;
  source: AssetSourceKind;
  kind: AssetKind;
  name: string;
  license: "cc0" | "user_owned" | "unknown";
  attributionRequired: boolean;
  author?: string;
  sourceUrl?: string;
  localPath?: string;
  thumbnailPath?: string;
  tags: string[];
};

export type Shot = {
  id: ID;
  projectId: ID;
  label: string;
  cameraName: string;
  status: "planned" | "ready" | "rendering" | "reviewed" | "accepted" | "rejected";
  notes: string[];
};

export type RenderRecord = {
  id: ID;
  shotId: ID;
  projectId: ID;
  path: string;
  width: number;
  height: number;
  createdAt: string;
  reviewId?: ID;
};

export type ReviewNote = {
  id: ID;
  renderId: ID;
  modelLane: ModelLane;
  summary: string;
  strengths: string[];
  issues: string[];
  proposedRevisionTaskIds: ID[];
  createdAt: string;
};
