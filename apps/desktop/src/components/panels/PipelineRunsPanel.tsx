import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Ban,
  Check,
  ChevronDown,
  Loader2,
  ListOrdered,
  MinusCircle,
  RefreshCw,
  XCircle
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
  getPipelineRun,
  listPipelineRuns,
  type PipelineRunRecord,
  type PipelineRunStepResult
} from "@/sidecarApi";
import { subscribeToRun, type SseSubscription } from "@/eventStream";

export type RunStatusLabel = "running" | "completed" | "failed" | "rejected";

export type RunLiveState = {
  status: RunStatusLabel;
  results: PipelineRunStepResult[];
  progress: { current: number; running: boolean } | null;
};

export interface PipelineRunsPanelProps {
  activeProjectId: string | null;
  className?: string;
}

const MAX_SSE_SUBSCRIPTIONS = 5;

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

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function previewOutput(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (typeof text !== "string") return null;
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function inferRunStatus(run: PipelineRunRecord): RunStatusLabel {
  const raw = (run as PipelineRunRecord & { status?: unknown }).status;
  if (typeof raw === "string") {
    const lower = raw.toLowerCase();
    if (lower === "running" || lower === "in_progress") return "running";
    if (lower === "completed" || lower === "succeeded" || lower === "ok")
      return "completed";
    if (lower === "failed" || lower === "error") return "failed";
    if (lower === "rejected") return "rejected";
  }
  const completedAt = (run as PipelineRunRecord & { completedAt?: string })
    .completedAt;
  if (!completedAt) return "running";
  const anyFailed = run.results.some((step) => step.status === "failed");
  return anyFailed ? "failed" : "completed";
}

function RunStatusBadge({ status }: { status: RunStatusLabel }) {
  if (status === "running") {
    return (
      <Badge
        variant="outline"
        className="inline-flex items-center gap-1 border-sky-400 text-sky-700"
      >
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        running
      </Badge>
    );
  }
  if (status === "completed") {
    return (
      <Badge variant="success" className="inline-flex items-center gap-1">
        <Check className="h-3 w-3" aria-hidden />
        completed
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="destructive" className="inline-flex items-center gap-1">
        <Ban className="h-3 w-3" aria-hidden />
        {status}
      </Badge>
    );
  }
  // failed
  return (
    <Badge variant="destructive" className="inline-flex items-center gap-1">
      <XCircle className="h-3 w-3" aria-hidden />
      {status}
    </Badge>
  );
}

function StepStatusBadge({ status }: { status: PipelineRunStepResult["status"] }) {
  if (status === "succeeded")
    return (
      <Badge variant="success" className="inline-flex items-center gap-1">
        <Check className="h-3 w-3" aria-hidden />
        succeeded
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="destructive" className="inline-flex items-center gap-1">
        <XCircle className="h-3 w-3" aria-hidden />
        failed
      </Badge>
    );
  if (status === "running")
    return (
      <Badge variant="outline" className="inline-flex items-center gap-1 border-sky-400 text-sky-700">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        running
      </Badge>
    );
  if (status === "skipped")
    return (
      <Badge variant="secondary" className="inline-flex items-center gap-1">
        <MinusCircle className="h-3 w-3" aria-hidden />
        skipped
      </Badge>
    );
  return <Badge variant="outline">{status}</Badge>;
}

function RunStepRow({ step }: { step: PipelineRunStepResult }) {
  const output = previewOutput(step.output);
  return (
    <div className="grid gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="font-mono text-[11px] text-muted-foreground">
          {step.stepId}
        </strong>
        <Badge variant="secondary" className="text-[10px]">
          {step.lane}
        </Badge>
        <StepStatusBadge status={step.status} />
      </div>
      {step.error ? (
        <p className="text-xs text-destructive break-words">{step.error}</p>
      ) : null}
      {output ? (
        <code className="block break-all font-mono text-[11px] text-muted-foreground">
          {output}
        </code>
      ) : null}
    </div>
  );
}

function RunRow({
  run,
  liveStatus,
  liveResults,
  liveProgress
}: {
  run: PipelineRunRecord;
  liveStatus: RunStatusLabel;
  liveResults: PipelineRunStepResult[];
  liveProgress: { current: number; running: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  const heading =
    run.prompt && run.prompt.trim().length > 0 ? run.prompt : run.definitionId;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border border-border bg-card"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full flex-col gap-2 px-3 py-2 text-left rounded-md hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <RunStatusBadge status={liveStatus} />
            <strong className="text-sm font-medium text-foreground">
              {truncate(heading, 80)}
            </strong>
            <ChevronDown
              className={cn(
                "ml-auto h-4 w-4 text-muted-foreground transition-transform",
                open && "rotate-180"
              )}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{relativeTime(run.startedAt)}</span>
            <Badge variant="secondary" className="text-[10px]">
              {liveResults.length}{" "}
              {liveResults.length === 1 ? "step" : "steps"}
            </Badge>
            {liveProgress && liveStatus === "running" ? (
              <span>
                Step {liveProgress.current}
                {liveResults.length ? `/${liveResults.length}` : ""} ·{" "}
                {liveProgress.running ? "running" : "queued"}
              </span>
            ) : null}
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/60 bg-muted/20 p-3">
        {liveResults.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            No step results yet.
          </span>
        ) : (
          <div className="grid gap-2">
            {liveResults.map((step) => (
              <RunStepRow key={step.stepId} step={step} />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PipelineRunsPanel({
  activeProjectId,
  className
}: PipelineRunsPanelProps) {
  const [runs, setRuns] = useState<PipelineRunRecord[]>([]);
  const [liveById, setLiveById] = useState<Record<string, RunLiveState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const subscriptionsRef = useRef<Map<string, SseSubscription>>(new Map());

  const load = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        const filter = activeProjectId ? { projectId: activeProjectId } : undefined;
        const result = await listPipelineRuns(filter);
        setRuns(result.runs);
        setError(null);
        hasLoadedRef.current = true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load pipeline runs"
        );
        if (!hasLoadedRef.current) setRuns([]);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [activeProjectId]
  );

  const refreshRun = useCallback(async (runId: string) => {
    try {
      const result = await getPipelineRun(runId);
      setRuns((current) => {
        const idx = current.findIndex((entry) => entry.id === runId);
        if (idx < 0) return [result.run, ...current];
        const next = current.slice();
        next[idx] = result.run;
        return next;
      });
      setLiveById((current) => {
        if (!(runId in current)) return current;
        const next = { ...current };
        delete next[runId];
        return next;
      });
    } catch {
      // Polling will eventually pick up the final state.
    }
  }, []);

  useEffect(() => {
    hasLoadedRef.current = false;
    void load(true);
    const interval = window.setInterval(() => {
      void load(false);
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    const runningRuns = runs
      .filter((run) => inferRunStatus(run) === "running")
      .slice()
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )
      .slice(0, MAX_SSE_SUBSCRIPTIONS);
    const desired = new Set(runningRuns.map((run) => run.id));
    const subs = subscriptionsRef.current;

    for (const [runId, sub] of subs) {
      if (!desired.has(runId)) {
        sub.close();
        subs.delete(runId);
      }
    }

    for (const run of runningRuns) {
      if (subs.has(run.id)) continue;
      const sub = subscribeToRun(run.id, {
        onStepStarted: (event) => {
          const stepId =
            typeof event.step.id === "string"
              ? event.step.id
              : String(
                  (event.step as Record<string, unknown>)["id"] ?? ""
                );
          const lane =
            typeof event.step.lane === "string" ? event.step.lane : "";
          setLiveById((current) => {
            const prev =
              current[run.id] ??
              { status: "running" as const, results: run.results, progress: null };
            const exists = prev.results.some((r) => r.stepId === stepId);
            const results = exists
              ? prev.results.map((r) =>
                  r.stepId === stepId ? { ...r, status: "running" as const } : r
                )
              : [
                  ...prev.results,
                  { stepId, lane, status: "running" as const }
                ];
            return {
              ...current,
              [run.id]: {
                status: "running",
                results,
                progress: { current: results.length, running: true }
              }
            };
          });
        },
        onStepCompleted: (event) => {
          const stepId =
            typeof event.result.stepId === "string"
              ? event.result.stepId
              : String(
                  (event.result as Record<string, unknown>)["stepId"] ?? ""
                );
          const lane =
            typeof event.result.lane === "string" ? event.result.lane : "";
          const status = (event.result.status ??
            "succeeded") as PipelineRunStepResult["status"];
          setLiveById((current) => {
            const prev =
              current[run.id] ??
              { status: "running" as const, results: run.results, progress: null };
            const existsIdx = prev.results.findIndex(
              (r) => r.stepId === stepId
            );
            const merged: PipelineRunStepResult = {
              stepId,
              lane,
              status,
              ...(event.result.output !== undefined
                ? { output: event.result.output }
                : {}),
              ...(typeof event.result.error === "string"
                ? { error: event.result.error }
                : {})
            };
            const results =
              existsIdx >= 0
                ? prev.results.map((r, i) =>
                    i === existsIdx ? merged : r
                  )
                : [...prev.results, merged];
            return {
              ...current,
              [run.id]: {
                status: "running",
                results,
                progress: { current: results.length, running: false }
              }
            };
          });
        },
        onCompleted: () => {
          const sub = subs.get(run.id);
          sub?.close();
          subs.delete(run.id);
          void refreshRun(run.id);
        },
        onError: () => {
          const sub = subs.get(run.id);
          sub?.close();
          subs.delete(run.id);
        }
      });
      subs.set(run.id, sub);
    }
  }, [runs, refreshRun]);

  useEffect(() => {
    return () => {
      for (const sub of subscriptionsRef.current.values()) {
        sub.close();
      }
      subscriptionsRef.current.clear();
    };
  }, []);

  return (
    <Card className={cn("col-span-12 lg:col-span-7", className)} id="runs">
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold tracking-tight">Pipeline runs</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Recent orchestrator runs
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh pipeline runs"
          title="Refresh"
          disabled={loading}
          onClick={() => void load(true)}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-destructive">Could not load runs</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(true)}
              disabled={loading}
            >
              Retry
            </Button>
          </div>
        ) : null}

        <div className="grid gap-2">
          {loading && !hasLoadedRef.current ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : runs.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ListOrdered
                className="mb-3 h-10 w-10 text-muted-foreground/40"
                aria-hidden
              />
              <p className="text-sm font-medium">No runs yet</p>
              <p className="mt-1 max-w-[32ch] text-sm text-muted-foreground">
                {activeProjectId
                  ? "Submit a pipeline from the topbar to kick off a run for this project."
                  : "Submit a pipeline run from the topbar to see it here."}
              </p>
            </div>
          ) : (
            runs.map((run) => {
              const live = liveById[run.id];
              const liveResults = live ? live.results : run.results;
              const liveStatus = live ? live.status : inferRunStatus(run);
              const liveProgress = live ? live.progress : null;
              return (
                <RunRow
                  key={run.id}
                  run={run}
                  liveStatus={liveStatus}
                  liveResults={liveResults}
                  liveProgress={liveProgress}
                />
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
