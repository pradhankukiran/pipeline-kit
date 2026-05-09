import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Ban,
  Check,
  CircleSlash,
  Clock,
  ClipboardCheck,
  RefreshCw,
  X
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/components/ui/tabs";
import {
  decideApproval,
  listApprovals,
  type ApprovalRecord
} from "@/sidecarApi";
import type { OperationRecord } from "@/fallbackData";
import { inferOutputPath, renderUrlFromOutputPath } from "@/lib/renderUrl";

export type ApprovalStatusFilter =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "all";

export interface ReviewPanelProps {
  activeProjectId: string | null;
  refreshTick?: number;
  className?: string;
  /**
   * Recent typed-op records used to find render thumbnails associated with
   * an approval (currently a best-effort match — by stepId or fallback to
   * the most recent render for a `review` payload).
   */
  recentOperations?: OperationRecord[];
}

const TABS: { id: ApprovalStatusFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" }
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
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
  return new Date(iso).toLocaleDateString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function StatusBadge({ status }: { status: ApprovalRecord["status"] }) {
  if (status === "approved") {
    return (
      <Badge variant="success" className="inline-flex items-center gap-1">
        <Check className="h-3 w-3 mr-1" aria-hidden />
        approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="destructive" className="inline-flex items-center gap-1">
        <Ban className="h-3 w-3 mr-1" aria-hidden />
        rejected
      </Badge>
    );
  }
  if (status === "cancelled") {
    // Distinct from "rejected": the user did not deny the step — the
    // surrounding run was cancelled while the gate was still polling.
    // Italic + muted styling reinforces the auto-set, non-decided origin.
    return (
      <Badge
        variant="outline"
        className="inline-flex items-center gap-1 border-muted-foreground/40 text-muted-foreground italic"
      >
        <CircleSlash className="h-3 w-3 mr-1" aria-hidden />
        cancelled
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="inline-flex items-center gap-1 border-amber-400 text-amber-700"
    >
      <Clock className="h-3 w-3 mr-1" aria-hidden />
      pending
    </Badge>
  );
}

function PayloadDetails({ payload }: { payload: unknown }) {
  const record = asRecord(payload);
  if (!record) {
    const preview = (() => {
      try {
        return JSON.stringify(payload);
      } catch {
        return String(payload);
      }
    })();
    const truncated =
      preview && preview.length > 200 ? `${preview.slice(0, 200)}…` : preview;
    return (
      <p className="text-xs text-muted-foreground break-all">
        {truncated || "(no payload)"}
      </p>
    );
  }

  const stepId = typeof record.stepId === "string" ? record.stepId : null;
  const lane = typeof record.lane === "string" ? record.lane : null;
  const operation = asRecord(record.operation);
  const opType =
    operation && typeof operation.type === "string" ? operation.type : null;
  const params = operation ? asRecord(operation.params) : null;
  const paramKeys = params ? Object.keys(params) : [];

  return (
    <div className="grid gap-2 text-xs">
      {stepId ? (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground w-16 shrink-0">stepId</span>
          <code className="font-mono text-[11px] text-muted-foreground">
            {stepId}
          </code>
        </div>
      ) : null}
      {lane ? (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground w-16 shrink-0">lane</span>
          <Badge variant="secondary">{lane}</Badge>
        </div>
      ) : null}
      {opType ? (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground w-16 shrink-0">op</span>
          <code className="font-mono text-[11px] text-muted-foreground">
            {opType}
          </code>
        </div>
      ) : null}
      {paramKeys.length > 0 ? (
        <div className="flex items-start gap-3">
          <span className="text-muted-foreground w-16 shrink-0">params</span>
          <span className="text-foreground">
            {paramKeys.slice(0, 8).join(", ")}
            {paramKeys.length > 8 ? "…" : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function findRenderThumbnailForApproval(
  approval: ApprovalRecord,
  operations: ReadonlyArray<OperationRecord>
): { url: string; outputPath: string } | null {
  const record = asRecord(approval.payload);
  const kind = record && typeof record.kind === "string" ? record.kind : null;
  if (kind !== "review") {
    return null;
  }

  // Best-effort matching: if the review payload references a stepId, look
  // for an op with the same id; otherwise fall back to the most recent op
  // that resolves to a render URL. This is intentionally lightweight —
  // the sidecar may not always link approvals back to render ops.
  const stepId =
    record && typeof record.stepId === "string" ? record.stepId : null;
  const candidates = operations.slice();
  const matched = stepId
    ? candidates.find((op) => op.id === stepId || op.title.includes(stepId))
    : null;
  const ordered = matched
    ? [matched, ...candidates.filter((op) => op !== matched)]
    : candidates;

  for (const op of ordered) {
    const outputPath = inferOutputPath(op);
    if (!outputPath) continue;
    const url = renderUrlFromOutputPath(outputPath);
    if (!url) continue;
    return { url, outputPath };
  }
  return null;
}

function ApprovalRow({
  approval,
  busy,
  thumbnail,
  onDecide
}: {
  approval: ApprovalRecord;
  busy: boolean;
  thumbnail: { url: string; outputPath: string } | null;
  onDecide: (status: "approved" | "rejected") => void;
}) {
  const [open, setOpen] = useState(false);
  const hasPayload =
    approval.payload !== undefined && approval.payload !== null;
  const isCancelled = approval.status === "cancelled";

  return (
    <div
      className={cn(
        "rounded-md border border-border p-3 space-y-2",
        isCancelled && "border-dashed bg-muted/20 text-muted-foreground"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
            {approval.kind}
          </p>
          <div className="flex items-start gap-3">
            <p
              className={cn(
                "text-sm font-medium break-words flex-1",
                isCancelled && "italic"
              )}
            >
              {approval.summary}
            </p>
            <StatusBadge status={approval.status} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {relativeTime(approval.createdAt)}
        </span>
        {approval.status === "pending" ? (
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onDecide("approved")}
            >
              <Check />
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => onDecide("rejected")}
            >
              <X />
              Reject
            </Button>
          </div>
        ) : null}
      </div>

      {approval.status !== "pending" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          {approval.decidedAt ? (
            <span>{relativeTime(approval.decidedAt)}</span>
          ) : null}
          {approval.decidedBy ? <span>by {approval.decidedBy}</span> : null}
          {approval.reason ? <span>“{approval.reason}”</span> : null}
        </div>
      ) : null}

      {thumbnail ? (
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-2">
          <img
            src={thumbnail.url}
            alt={`Render for ${approval.id}`}
            loading="lazy"
            decoding="async"
            className="h-20 w-20 shrink-0 rounded-md border border-border bg-secondary object-cover"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Associated render
            </p>
            <code className="block break-all font-mono text-[11px] text-muted-foreground">
              {thumbnail.outputPath}
            </code>
          </div>
        </div>
      ) : null}

      {hasPayload ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-xs text-muted-foreground"
            >
              {open ? "Hide details" : "Show details"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded-md border border-border bg-muted/40 p-3">
            <PayloadDetails payload={approval.payload} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function emptyStateCopy(scope: ApprovalStatusFilter): {
  heading: string;
  description: string;
} {
  if (scope === "pending") {
    return {
      heading: "No pending approvals.",
      description: "Approvals raised by the planner will appear here for review."
    };
  }
  if (scope === "approved") {
    return {
      heading: "No approved decisions yet.",
      description: "Approved approvals will be listed here once decided."
    };
  }
  if (scope === "rejected") {
    return {
      heading: "No rejected decisions yet.",
      description: "Rejected approvals will be listed here once decided."
    };
  }
  if (scope === "cancelled") {
    return {
      heading: "No cancelled approvals yet.",
      description:
        "Approvals auto-cancelled by run cancellation will be listed here."
    };
  }
  return {
    heading: "No approvals yet.",
    description: "Decisions across all scopes will be collected here."
  };
}

export function ReviewPanel({
  activeProjectId,
  refreshTick = 0,
  className,
  recentOperations
}: ReviewPanelProps) {
  const [status, setStatus] = useState<ApprovalStatusFilter>("pending");
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const operations = useMemo(
    () => recentOperations ?? [],
    [recentOperations]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listApprovals({
        projectId: activeProjectId ?? undefined,
        status: status === "all" ? undefined : status
      });
      setApprovals(result.approvals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, status]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  async function handleDecide(
    id: string,
    decision: "approved" | "rejected"
  ) {
    setPendingId(id);
    try {
      await decideApproval(id, { status: decision, decidedBy: "user" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update approval");
    } finally {
      setPendingId(null);
    }
  }

  const empty = emptyStateCopy(status);

  return (
    <Card className={cn("col-span-12 lg:col-span-5", className)} id="review">
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold tracking-tight">
            Review queue
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Approvals awaiting decision
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh approvals"
          title="Refresh"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs
          value={status}
          onValueChange={(value) => setStatus(value as ApprovalStatusFilter)}
        >
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={status} className="mt-4 space-y-4">
            {error ? (
              <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                  aria-hidden
                />
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium text-destructive">
                    Could not load approvals
                  </p>
                  <p className="text-xs text-muted-foreground">{error}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  Retry
                </Button>
              </div>
            ) : null}

            <div className="space-y-3">
              {loading ? (
                <>
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </>
              ) : approvals.length === 0 && !error ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ClipboardCheck
                    className="mb-3 h-10 w-10 text-muted-foreground/40"
                    aria-hidden
                  />
                  <p className="text-sm font-medium">{empty.heading}</p>
                  <p className="mt-1 max-w-[28ch] text-sm text-muted-foreground">
                    {empty.description}
                  </p>
                </div>
              ) : (
                approvals.map((approval) => (
                  <ApprovalRow
                    key={approval.id}
                    approval={approval}
                    busy={pendingId === approval.id}
                    thumbnail={findRenderThumbnailForApproval(
                      approval,
                      operations
                    )}
                    onDecide={(decision) =>
                      void handleDecide(approval.id, decision)
                    }
                  />
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
