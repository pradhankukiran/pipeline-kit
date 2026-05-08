import { clsx } from "clsx";
import {
  Loader2,
  Play,
  RefreshCw,
  Settings as SettingsIcon
} from "lucide-react";
import { useMatch, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ProjectPicker } from "@/components/panels/ProjectPicker";
import { useDashboard } from "@/dashboard-context";
import type { SidecarHealth } from "@/sidecarApi";
import { sidecarBaseUrl } from "@/sidecarApi";

export function Metric({
  label,
  value,
  tone,
  compact
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-md border border-border bg-white",
        compact ? "px-3 py-2" : "p-3"
      )}
    >
      <span
        className={clsx(
          "block font-medium uppercase tracking-wide text-muted-foreground",
          compact ? "text-[10px] leading-tight" : "text-[11px]"
        )}
      >
        {label}
      </span>
      <strong
        className={clsx(
          "block font-semibold tracking-tight",
          compact ? "text-sm leading-tight" : "mt-1 text-xl",
          tone === "good" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
          !tone && "text-foreground"
        )}
      >
        {value}
      </strong>
    </div>
  );
}

export function ApiStatusIndicator({
  health,
  loading,
  error,
  message
}: {
  health: SidecarHealth | null;
  loading: boolean;
  error: string | null;
  message: string | null;
}) {
  const status = health?.status ?? "offline";
  const label = loading ? "Checking sidecar" : health?.ok ? "Sidecar online" : "Static fallback";
  const detail = message ?? error ?? sidecarBaseUrl;

  const dotCls =
    loading
      ? "bg-muted-foreground animate-pulse"
      : health?.ok
        ? "bg-emerald-500"
        : status === "degraded"
          ? "bg-amber-500"
          : "bg-rose-500";

  return (
    <div
      className="hidden items-center gap-2 rounded-md border border-border bg-white px-3 py-2 sm:flex"
      title={detail}
    >
      <span
        className={clsx("h-2 w-2 shrink-0 rounded-full", dotCls)}
        aria-hidden
      />
      <span className="text-xs font-medium text-foreground">{label}</span>
    </div>
  );
}

/**
 * Returns the four topbar slots (projectPicker, topbarMetrics, apiStatus,
 * topbarActions) wired to dashboard context. The project picker selection
 * navigates to the per-project overview route.
 */
export function useTopbarSlots() {
  const navigate = useNavigate();
  const projectMatch = useMatch("/projects/:projectId/*");
  const currentProjectId = projectMatch?.params.projectId ?? null;
  const {
    projects,
    projectsLoading,
    snapshot,
    handleSelectProject,
    health,
    loading,
    error,
    message,
    actions,
    handleSyncBlender,
    handleRunPlanner,
    setSettingsOpen
  } = useDashboard();

  const projectPicker = (
    <ProjectPicker
      projects={projects}
      currentProjectId={currentProjectId}
      loading={projectsLoading}
      onSelect={(id) => {
        void handleSelectProject(id);
        navigate(`/projects/${id}/overview`);
      }}
      onCreateRequested={() => navigate("/")}
    />
  );

  const topbarMetrics = (
    <>
      <Metric label="Progress" value={snapshot.metrics.progress} tone="good" compact />
      <Metric label="Blockers" value={snapshot.metrics.blockers} tone="warn" compact />
      <Metric label="Assets" value={snapshot.metrics.assets} compact />
      <Metric label="Review" value={snapshot.metrics.review} compact />
    </>
  );

  const apiStatus = (
    <ApiStatusIndicator
      health={health}
      loading={loading}
      error={error}
      message={message}
    />
  );

  const topbarActions = (
    <>
      <Button
        type="button"
        variant="outline"
        size="default"
        onClick={() => void handleSyncBlender()}
        disabled={actions.sync || loading}
      >
        {actions.sync ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {actions.sync ? "Syncing…" : "Sync Blender"}
      </Button>
      <Button
        type="button"
        size="default"
        onClick={() => void handleRunPlanner()}
        disabled={actions.planner || loading}
      >
        {actions.planner ? <Loader2 className="animate-spin" /> : <Play />}
        {actions.planner ? "Submitting…" : "Run Planner"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setSettingsOpen(true)}
        aria-label="Open settings"
      >
        <SettingsIcon />
      </Button>
    </>
  );

  return { projectPicker, topbarMetrics, apiStatus, topbarActions };
}
