import * as React from "react";
import {
  AlertCircle,
  Box,
  Camera,
  Layers,
  Lightbulb,
  Plug,
  RefreshCw
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getSceneInfo, type SceneInfoResponse } from "@/sidecarApi";

export interface SceneStatePanelProps {
  enabled: boolean;
  className?: string;
}

const POLL_INTERVAL_MS = 5000;

const OBJECT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  MESH: Box,
  LIGHT: Lightbulb,
  CAMERA: Camera
};

export function SceneStatePanel({ enabled, className }: SceneStatePanelProps) {
  const [response, setResponse] = React.useState<SceneInfoResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [now, setNow] = React.useState<number>(() => Date.now());
  const inFlight = React.useRef(false);

  const fetchOnce = React.useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setRefreshing(true);
    try {
      const next = await getSceneInfo();
      setResponse(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch scene info");
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    void fetchOnce();
    const handle = window.setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(handle);
    };
  }, [enabled, fetchOnce]);

  // Tick once a second so the "Updated x ago" footer stays fresh between polls.
  React.useEffect(() => {
    const handle = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(handle);
    };
  }, []);

  const onRefresh = React.useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  const isFirstLoad = response === null && error === null;
  const connected = response?.connected === true;
  const scene = response?.scene ?? null;

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold tracking-tight">
            Scene state
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Live Blender state
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh scene state"
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="flex-1">
        {isFirstLoad ? (
          <SkeletonRows />
        ) : error ? (
          <ErrorState message={error} onRetry={onRefresh} retrying={refreshing} />
        ) : !connected ? (
          <DisconnectedState />
        ) : scene ? (
          <SceneView
            scene={scene}
            fetchedAt={response?.fetchedAt}
            now={now}
          />
        ) : (
          <SkeletonRows />
        )}
      </CardContent>
    </Card>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

function DisconnectedState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Plug className="mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
      <p className="text-sm font-medium">Blender not connected</p>
      <p className="mt-1 max-w-[28ch] text-sm text-muted-foreground">
        Click Connect on the Blender Session card to start.
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  retrying
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <AlertCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
        aria-hidden
      />
      <div className="flex-1 space-y-2">
        <p className="text-sm font-medium text-destructive">
          Scene info unavailable
        </p>
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        Retry
      </Button>
    </div>
  );
}

function SceneView({
  scene,
  fetchedAt,
  now
}: {
  scene: NonNullable<SceneInfoResponse["scene"]>;
  fetchedAt: string | undefined;
  now: number;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="truncate text-base font-semibold tracking-tight"
          title={scene.sceneName}
        >
          {scene.sceneName}
        </p>
        <Badge variant="secondary" className="font-mono text-[11px]">
          {scene.engine}
        </Badge>
      </div>

      <p className="font-mono text-xs text-muted-foreground">
        Frame {scene.frame.current} of {scene.frame.start}-{scene.frame.end}
      </p>

      <p className="text-xs text-muted-foreground">
        {scene.activeCameraName
          ? `Active camera: ${scene.activeCameraName}`
          : "No active camera"}
      </p>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
          Objects
        </p>
        {scene.objects.length === 0 ? (
          <p className="text-xs text-muted-foreground">No objects in scene.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {scene.objects.map((entry) => (
              <ObjectRow key={entry.type} type={entry.type} count={entry.count} />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-1 text-xs text-muted-foreground">
        <span>
          {scene.materials.length} {scene.materials.length === 1 ? "material" : "materials"}
        </span>
        <span>{formatRelative(fetchedAt, now)}</span>
      </div>
    </div>
  );
}

function ObjectRow({ type, count }: { type: string; count: number }) {
  const Icon = OBJECT_ICONS[type] ?? Layers;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {type}
        </p>
      </div>
      <Badge variant="secondary" className="font-mono text-[11px]">
        × {count}
      </Badge>
    </div>
  );
}

function formatRelative(iso: string | undefined, now: number): string {
  if (!iso) {
    return "Updated just now";
  }
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) {
    return "Updated just now";
  }

  const deltaSeconds = Math.max(0, Math.floor((now - then) / 1000));
  if (deltaSeconds < 5) {
    return "Updated just now";
  }
  if (deltaSeconds < 60) {
    return `Updated ${deltaSeconds}s ago`;
  }
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `Updated ${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}
