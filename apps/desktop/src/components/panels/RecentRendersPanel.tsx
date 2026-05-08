import { useMemo, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { OperationRecord } from "@/fallbackData";
import { inferOutputPath, renderUrlFromOutputPath } from "@/lib/renderUrl";

const MAX_RENDERS = 12;

export interface RecentRendersPanelProps {
  operations: OperationRecord[];
  loading?: boolean;
  className?: string;
}

interface RenderEntry {
  readonly opId: string;
  readonly title: string;
  readonly thumbUrl: string;
  readonly outputPath: string;
}

/**
 * Builds the list of renderable thumbnails from the recent-operations list.
 * We filter to ops whose output path resolves to a sidecar URL, dedupe by
 * opId (most recent wins), and cap at {@link MAX_RENDERS}.
 */
function selectRenders(operations: OperationRecord[]): RenderEntry[] {
  const seen = new Set<string>();
  const entries: RenderEntry[] = [];
  for (const op of operations) {
    if (entries.length >= MAX_RENDERS) {
      break;
    }
    const outputPath = inferOutputPath(op);
    if (!outputPath) {
      continue;
    }
    const thumbUrl = renderUrlFromOutputPath(outputPath);
    if (!thumbUrl) {
      continue;
    }
    if (seen.has(op.id)) {
      continue;
    }
    seen.add(op.id);
    entries.push({
      opId: op.id,
      title: op.title,
      thumbUrl,
      outputPath
    });
  }
  return entries;
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="space-y-2">
          <Skeleton className="aspect-square w-full rounded-md" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-12 text-center">
      <ImageIcon className="mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
      <p className="text-sm font-medium">No renders yet</p>
      <p className="mt-1 max-w-[36ch] text-sm text-muted-foreground">
        Run a <span className="font-mono">render_shot</span> op to see the
        latest frames here.
      </p>
    </div>
  );
}

export function RecentRendersPanel({
  operations,
  loading = false,
  className
}: RecentRendersPanelProps) {
  const renders = useMemo(() => selectRenders(operations), [operations]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const active = activeIndex !== null ? renders[activeIndex] ?? null : null;

  return (
    <Card id="recent-renders" className={cn("flex flex-col", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-tight">
          Recent renders
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Latest output from render_shot ops
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingGrid />
        ) : renders.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {renders.map((render, index) => (
              <button
                key={render.opId}
                type="button"
                onClick={() => setActiveIndex(index)}
                className="group flex flex-col gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
                title={render.outputPath}
              >
                <img
                  src={render.thumbUrl}
                  alt={`Render output ${render.opId}`}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full rounded-md border border-border bg-secondary object-cover transition-opacity group-hover:opacity-90"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
                <span
                  className="truncate font-mono text-[11px] text-muted-foreground"
                  title={render.opId}
                >
                  {render.opId}
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActiveIndex(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {active?.opId ?? ""}
            </DialogTitle>
            <DialogDescription className="break-all text-xs">
              {active?.outputPath ?? ""}
            </DialogDescription>
          </DialogHeader>
          {active ? (
            <img
              src={active.thumbUrl}
              alt={`Render output ${active.opId}`}
              className="max-h-[70vh] w-full rounded-md border border-border bg-secondary object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
