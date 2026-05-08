import * as React from "react";
import {
  BookmarkPlus,
  Box,
  Camera,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  Paintbrush,
  Play,
  Plug,
  ScanEye,
  Sparkles,
  Wrench
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

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

export type BlenderToolItem = {
  name: string;
  description: string;
};

export type BlenderActionFlags = {
  connect: boolean;
  tools: boolean;
  demo: boolean;
};

export type BlenderSessionPanelProps = {
  session: BlenderSessionView;
  tools: BlenderToolItem[];
  ops: QuickOp[];
  opStates: OpStateMap;
  actions: BlenderActionFlags;
  loading: boolean;
  onConnect: () => void;
  onListTools: () => void;
  onRunDemo: () => void;
  onRunOp: (op: QuickOp) => void;
  className?: string;
};

const OP_ICONS: Record<BlenderOpId, React.ComponentType<{ className?: string }>> = {
  create_scene: Box,
  create_studio_set: Sparkles,
  apply_material: Paintbrush,
  create_lighting_rig: Lightbulb,
  create_camera_rig: Camera,
  render_shot: ImageIcon,
  inspect_scene: ScanEye,
  save_checkpoint: BookmarkPlus
};

function OpCard({
  op,
  state,
  onRun
}: {
  op: QuickOp;
  state: OpRunState;
  onRun: () => void;
}) {
  const Icon = OP_ICONS[op.id];
  const running = state.status === "running";
  const ok = state.status === "ok";
  const failed = state.status === "failed";

  const subtitleText = running
    ? "Running…"
    : ok
      ? state.summary ?? "Completed"
      : failed
        ? state.summary ?? "Failed"
        : op.blurb;

  const subtitleClass = ok
    ? "text-emerald-700"
    : failed
      ? "text-destructive"
      : "text-muted-foreground";

  return (
    <div className="group flex items-center gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:bg-accent/30 hover:border-foreground/15">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{op.label}</p>
        <p className={cn("mt-1 line-clamp-1 text-xs leading-snug", subtitleClass)}>
          {subtitleText}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRun}
        disabled={running}
        className="shrink-0"
      >
        {running ? <Loader2 className="animate-spin" /> : <Play />}
        Run
      </Button>
    </div>
  );
}

export function BlenderSessionPanel({
  session,
  tools,
  ops,
  opStates,
  actions,
  loading,
  onConnect,
  onListTools,
  onRunDemo,
  onRunOp,
  className
}: BlenderSessionPanelProps) {
  return (
    <Card className={cn("flex flex-col", className)} id="blender">
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold tracking-tight">
            Blender session
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Local Blender MCP bridge
          </CardDescription>
        </div>
        <Badge
          variant={session.connected ? "success" : "secondary"}
          className="inline-flex shrink-0 items-center"
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-current mr-1.5"
            aria-hidden
          />
          {session.connected ? "Connected" : "Disconnected"}
        </Badge>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="default"
              onClick={onConnect}
              disabled={actions.connect || loading}
            >
              {actions.connect ? <Loader2 className="animate-spin" /> : <Plug />}
              {actions.connect ? "Connecting…" : "Connect Blender"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onListTools}
              disabled={actions.tools || loading}
            >
              {actions.tools ? <Loader2 className="animate-spin" /> : <Wrench />}
              {actions.tools ? "Loading…" : "List Tools"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onRunDemo}
              disabled={actions.demo || loading}
            >
              {actions.demo ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {actions.demo ? "Submitting…" : "Run Product Viz Demo"}
            </Button>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="space-y-4">
          <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
            MCP tools{tools.length > 0 ? ` (${tools.length})` : ""}
          </p>
          {session.connected ? (
            tools.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No tools loaded yet. Click List Tools.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tools.map((tool) => (
                  <Badge
                    key={tool.name}
                    variant="outline"
                    title={tool.description}
                    className="font-mono text-[11px]"
                  >
                    {tool.name}
                  </Badge>
                ))}
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              Connect to see available tools.
            </p>
          )}
        </div>

        <Separator className="my-4" />

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
              Quick operations
            </p>
            <p className="text-xs text-muted-foreground">
              Run typed Blender ops with sensible defaults
            </p>
          </div>
          <div className="space-y-2">
            {ops.map((op) => (
              <OpCard
                key={op.id}
                op={op}
                state={opStates[op.id] ?? { status: "idle" }}
                onRun={() => onRunOp(op)}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
