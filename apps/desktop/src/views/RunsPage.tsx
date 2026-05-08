import { OperationsPanel } from "@/components/panels/OperationsPanel";
import { PipelineRunsPanel } from "@/components/panels/PipelineRunsPanel";
import { useDashboard } from "@/dashboard-context";

export function RunsPage() {
  const ctx = useDashboard();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Pipeline runs and recent typed-op activity.
        </p>
      </header>
      <PipelineRunsPanel activeProjectId={ctx.activeProjectId} />
      <OperationsPanel
        operations={ctx.operations}
        scope={ctx.opsScopeActive ? "active" : "all"}
        hasActiveProject={Boolean(ctx.activeProjectId)}
        loading={ctx.loading && ctx.operations.length === 0}
        onScopeChange={(next) => ctx.setOpsScopeActive(next === "active")}
      />
    </div>
  );
}
