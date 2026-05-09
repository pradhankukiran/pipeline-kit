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
  RotateCcw,
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
  cancelPipelineRun,
  getPipelineRun,
  listPipelineRuns,
  rerunPipelineFromStep,
  type PipelineRunRecord,
  type PipelineRunStepResult
} from "@/sidecarApi";
import { subscribeToRun, type SseSubscription } from "@/eventStream";
import { useDashboard } from "@/dashboard-context";

export type RunStatusLabel =
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled";

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
    if (lower === "cancelled" || lower === "canceled") return "cancelled";
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
  if (status === "cancelled") {
    return (
      <Badge variant="secondary" className="inline-flex items-center gap-1">
        <Ban className="h-3 w-3" aria-hidden />
        cancelled
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

function RunStepRow({
  step,
  rerunDisabled,
  rerunBusy,
  rerunDisabledReason,
  onRerun
}: {
  step: PipelineRunStepResult;
  rerunDisabled: boolean;
  rerunBusy: boolean;
  rerunDisabledReason: string | null;
  onRerun: (stepId: string) => void;
}) {
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-[11px]"
          disabled={rerunDisabled}
          title={rerunDisabledReason ?? "Rerun the pipeline from this step"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRerun(step.stepId);
          }}
        >
          {rerunBusy ? (
            <>
              <Loader2 className="animate-spin" />
              Rerunning…
            </>
          ) : (
            <>
              <RotateCcw />
              Rerun from here
            </>
          )}
        </Button>
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
  liveProgress,
  cancelBusy,
  onCancel,
  rerunBusyStepId,
  onRerunStep
}: {
  run: PipelineRunRecord;
  liveStatus: RunStatusLabel;
  liveResults: PipelineRunStepResult[];
  liveProgress: { current: number; running: boolean } | null;
  cancelBusy: boolean;
  onCancel: () => void;
  rerunBusyStepId: string | null;
  onRerunStep: (runId: string, stepId: string) => void;
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
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex flex-1 flex-col gap-2 text-left rounded-md hover:bg-muted/40 transition-colors -mx-1 px-1"
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
        {liveStatus === "running" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cancelBusy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }}
            aria-label={`Cancel run ${run.id}`}
            title="Cancel this running pipeline"
          >
            {cancelBusy ? (
              <>
                <Loader2 className="animate-spin" />
                Cancelling…
              </>
            ) : (
              <>
                <Ban />
                Cancel
              </>
            )}
          </Button>
        ) : null}
      </div>
      <CollapsibleContent className="border-t border-border/60 bg-muted/20 p-3">
        {liveResults.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            No step results yet.
          </span>
        ) : (
          <div className="grid gap-2">
            {liveResults.map((step) => {
              const hasOutput =
                step.output !== undefined && step.output !== null;
              const isRunning = liveStatus === "running";
              const rerunDisabled =
                isRunning ||
                !hasOutput ||
                step.status === "running" ||
                step.status === "pending";
              const rerunBusy = rerunBusyStepId === step.stepId;
              let reason: string | null = null;
              if (isRunning) {
                reason = "Wait for the run to finish before rerunning";
              } else if (!hasOutput) {
                reason = "No recorded output to seed the rerun from";
              } else if (
                step.status === "running" ||
                step.status === "pending"
              ) {
                reason = "Step has no terminal status to rerun from";
              }
              return (
                <RunStepRow
                  key={step.stepId}
                  step={step}
                  rerunDisabled={rerunDisabled || rerunBusy}
                  rerunBusy={rerunBusy}
                  rerunDisabledReason={reason}
                  onRerun={(stepId) => onRerunStep(run.id, stepId)}
                />
              );
            })}
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
  const { setSubmitBanner } = useDashboard();
  const [runs, setRuns] = useState<PipelineRunRecord[]>([]);
  const [liveById, setLiveById] = useState<Record<string, RunLiveState>>({});
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  // Tracks which (runId, stepId) is currently submitting a rerun. Keyed by
  // runId because only one step can rerun at a time per run.
  const [rerunBusyByRun, setRerunBusyByRun] = useState<Record<string, string>>(
    {}
  );
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

  const handleCancel = useCallback(
    async (runId: string) => {
      const confirmed =
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(
              "Cancel this running pipeline? The current step may still finish if it has already begun."
            )
          : true;
      if (!confirmed) return;

      setCancellingIds((current) => {
        if (current.has(runId)) return current;
        const next = new Set(current);
        next.add(runId);
        return next;
      });

      const result = await cancelPipelineRun(runId);

      setCancellingIds((current) => {
        if (!current.has(runId)) return current;
        const next = new Set(current);
        next.delete(runId);
        return next;
      });

      if (result.kind === "cancelled") {
        // Optimistically mark as cancelled until the next polling refresh
        // (or the SSE final event) catches up.
        setLiveById((current) => {
          const prev = current[runId];
          return {
            ...current,
            [runId]: {
              status: "cancelled",
              results: prev?.results ?? [],
              progress: null
            }
          };
        });
        const sub = subscriptionsRef.current.get(runId);
        sub?.close();
        subscriptionsRef.current.delete(runId);
        setSubmitBanner(`Cancelled run ${runId.slice(0, 8)}`);
        void refreshRun(runId);
        return;
      }
      if (result.kind === "already-terminal") {
        setSubmitBanner(
          `Run ${runId.slice(0, 8)} already finished — nothing to cancel.`
        );
        void load(false);
        return;
      }
      if (result.kind === "not-found") {
        setSubmitBanner(`Run ${runId.slice(0, 8)} could not be found.`);
        void load(false);
        return;
      }
      setSubmitBanner(`Cancel failed: ${result.message}`);
    },
    [load, refreshRun, setSubmitBanner]
  );

  const handleRerunStep = useCallback(
    async (originalRunId: string, fromStepId: string) => {
      setRerunBusyByRun((current) => ({ ...current, [originalRunId]: fromStepId }));
      try {
        const result = await rerunPipelineFromStep(originalRunId, fromStepId);
        if (!result) {
          setSubmitBanner(
            `Rerun failed for step ${fromStepId} — sidecar refused.`
          );
          return;
        }
        // Optimistically prepend a placeholder run for the new runId so the
        // SSE wiring picks it up on the next list refresh; the polling
        // interval will replace it with the canonical record shortly.
        const placeholder: PipelineRunRecord = {
          id: result.runId,
          projectId: null,
          definitionId: `rerun:${originalRunId.slice(0, 8)}`,
          startedAt: new Date().toISOString(),
          completedAt: "",
          results: []
        };
        setRuns((current) => {
          if (current.some((entry) => entry.id === result.runId)) {
            return current;
          }
          return [placeholder, ...current];
        });
        setSubmitBanner(
          `Rerun submitted from ${fromStepId} · new run ${result.runId.slice(0, 8)}`
        );
        void load(false);
      } finally {
        setRerunBusyByRun((current) => {
          if (current[originalRunId] !== fromStepId) return current;
          const { [originalRunId]: _omit, ...rest } = current;
          void _omit;
          return rest;
        });
      }
    },
    [load, setSubmitBanner]
  );

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
                  cancelBusy={cancellingIds.has(run.id)}
                  onCancel={() => void handleCancel(run.id)}
                  rerunBusyStepId={rerunBusyByRun[run.id] ?? null}
                  onRerunStep={(rid, sid) => void handleRerunStep(rid, sid)}
                />
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
