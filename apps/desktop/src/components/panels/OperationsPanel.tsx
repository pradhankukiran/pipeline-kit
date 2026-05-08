import {
  Activity,
  Ban,
  BookmarkPlus,
  Box,
  Camera,
  Check,
  Clock,
  Dot,
  Eye,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  MinusCircle,
  Sparkles,
  Wand2,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { OperationRecord } from "@/fallbackData";
import { inferOutputPath, renderUrlFromOutputPath } from "@/lib/renderUrl";

export type OperationsScope = "active" | "all";

export interface OperationsPanelProps {
  operations: OperationRecord[];
  scope: OperationsScope;
  hasActiveProject: boolean;
  loading?: boolean;
  onScopeChange: (scope: OperationsScope) => void;
  className?: string;
}

const ICON_BY_TYPE: Record<string, LucideIcon> = {
  create_scene: Box,
  create_studio_set: Sparkles,
  apply_material: Wand2,
  create_camera_rig: Camera,
  create_lighting_rig: Lightbulb,
  render_shot: ImageIcon,
  inspect_scene: Eye,
  save_checkpoint: BookmarkPlus,
};

function iconForOperation(operation: OperationRecord): LucideIcon {
  const haystack = `${operation.id} ${operation.title} ${operation.detail}`.toLowerCase();
  for (const [key, Icon] of Object.entries(ICON_BY_TYPE)) {
    if (haystack.includes(key)) return Icon;
  }
  // Fallback: match on common words inside the title.
  if (haystack.includes("scene")) return Box;
  if (haystack.includes("camera")) return Camera;
  if (haystack.includes("light")) return Lightbulb;
  if (haystack.includes("render")) return ImageIcon;
  if (haystack.includes("material")) return Wand2;
  if (haystack.includes("checkpoint") || haystack.includes("save")) return BookmarkPlus;
  if (haystack.includes("inspect")) return Eye;
  if (haystack.includes("studio")) return Sparkles;
  return Dot;
}

type StatusToken = "ok" | "failed" | "skipped" | "running" | "queued" | "offline" | "other";

function statusToken(status: string): StatusToken {
  const lower = status.toLowerCase();
  if (lower === "complete" || lower === "completed" || lower === "ok" || lower === "succeeded") {
    return "ok";
  }
  if (lower === "failed" || lower === "error") return "failed";
  if (lower === "skipped") return "skipped";
  if (lower === "running" || lower === "in_progress") return "running";
  if (lower === "queued" || lower === "pending") return "queued";
  if (lower === "offline") return "offline";
  return "other";
}

const STATUS_ICON_BY_TOKEN: Record<StatusToken, LucideIcon | null> = {
  ok: Check,
  failed: XCircle,
  skipped: MinusCircle,
  running: Loader2,
  queued: Clock,
  offline: Ban,
  other: null,
};

function looksLikeIso(value: string): boolean {
  // Cheap check; relativeTime falls back to the raw string if it's not a date.
  return /\d{4}-\d{2}-\d{2}T/.test(value);
}

function relativeTime(input: string): string {
  if (!looksLikeIso(input)) return input;
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return input;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(input).toLocaleDateString();
}

function StatusBadge({ token, status }: { token: StatusToken; status: string }) {
  const StatusIcon = STATUS_ICON_BY_TOKEN[token];
  if (token === "ok") {
    return (
      <Badge variant="success" className="inline-flex items-center">
        {StatusIcon ? <StatusIcon className="h-3 w-3 mr-1" aria-hidden /> : null}
        {status}
      </Badge>
    );
  }
  if (token === "failed") {
    return (
      <Badge variant="destructive" className="inline-flex items-center">
        {StatusIcon ? <StatusIcon className="h-3 w-3 mr-1" aria-hidden /> : null}
        {status}
      </Badge>
    );
  }
  if (token === "skipped" || token === "offline") {
    return (
      <Badge variant="secondary" className="inline-flex items-center">
        {StatusIcon ? <StatusIcon className="h-3 w-3 mr-1" aria-hidden /> : null}
        {status}
      </Badge>
    );
  }
  if (token === "running") {
    return (
      <Badge
        variant="outline"
        className="inline-flex items-center border-sky-400 text-sky-700"
      >
        {StatusIcon ? (
          <StatusIcon className="h-3 w-3 mr-1 animate-spin" aria-hidden />
        ) : null}
        {status}
      </Badge>
    );
  }
  if (token === "queued") {
    return (
      <Badge
        variant="outline"
        className="inline-flex items-center border-amber-400 text-amber-700"
      >
        {StatusIcon ? <StatusIcon className="h-3 w-3 mr-1" aria-hidden /> : null}
        {status}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="inline-flex items-center">
      {status}
    </Badge>
  );
}

function OperationRow({ operation }: { operation: OperationRecord }) {
  const Icon = iconForOperation(operation);
  const token = statusToken(operation.status);
  const outputPath = inferOutputPath(operation);
  const thumbUrl = renderUrlFromOutputPath(outputPath);
  return (
    <div className="flex items-start gap-3 px-3 py-2 rounded-md hover:bg-muted/40 transition-colors">
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground",
          token === "failed" && "border-destructive/40 bg-destructive/10 text-destructive",
          token === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-700"
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{operation.title}</span>
          <span className="ml-auto">
            <StatusBadge token={token} status={operation.status} />
          </span>
        </div>
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {operation.detail}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {relativeTime(operation.createdAt)}
        </span>
      </div>
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={`Render output for ${operation.title}`}
          loading="lazy"
          decoding="async"
          className="h-12 w-12 shrink-0 rounded-md object-cover bg-secondary"
          onError={(event) => {
            // Hide thumbnails that fail to load (e.g. file missing on disk).
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}

export function OperationsPanel({
  operations,
  scope,
  hasActiveProject,
  loading = false,
  onScopeChange,
  className,
}: OperationsPanelProps) {
  return (
    <Card id="operations" className={cn("flex h-full flex-col", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-tight">Operations</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Recent typed-op runs
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <Tabs
          value={scope}
          onValueChange={(value) => onScopeChange(value as OperationsScope)}
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger
              value="active"
              disabled={!hasActiveProject}
              title={
                hasActiveProject
                  ? "Show operations for the active project"
                  : "Select a project to scope operations"
              }
            >
              Active project
            </TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>

          <TabsContent value={scope} className="space-y-2 mt-0">
            {loading ? (
              <>
                <LoadingRow />
                <LoadingRow />
                <LoadingRow />
              </>
            ) : operations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Activity
                  className="mb-3 h-10 w-10 text-muted-foreground/40"
                  aria-hidden
                />
                <p className="text-sm font-medium">No operations yet</p>
                <p className="mt-1 max-w-[28ch] text-sm text-muted-foreground">
                  {scope === "active" && hasActiveProject
                    ? "Run a typed Blender op to see activity for this project."
                    : "Run a typed Blender op to see activity here."}
                </p>
              </div>
            ) : (
              operations.map((operation) => (
                <OperationRow key={operation.id} operation={operation} />
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
