import { ReviewPanel } from "@/components/panels/ReviewPanel";
import { useDashboard } from "@/dashboard-context";

export function ReviewPage() {
  const ctx = useDashboard();
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-sm text-muted-foreground">
          Approvals awaiting decision for the active project.
        </p>
      </header>
      <ReviewPanel
        activeProjectId={ctx.activeProjectId}
        refreshTick={ctx.approvalsRefreshTick}
        recentOperations={ctx.operations}
      />
    </div>
  );
}
