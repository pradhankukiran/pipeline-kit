import { X } from "lucide-react";

import { AssetsSearchPanel } from "@/components/panels/AssetsSearchPanel";
import { BlenderSessionPanel } from "@/components/panels/BlenderSessionPanel";
import { BriefPanel } from "@/components/panels/BriefPanel";
import { OperationsPanel } from "@/components/panels/OperationsPanel";
import { PipelineRunsPanel } from "@/components/panels/PipelineRunsPanel";
import { ProductionBoardPanel } from "@/components/panels/ProductionBoardPanel";
import { ReviewPanel } from "@/components/panels/ReviewPanel";
import {
  ShotBoardPanel,
  shotsFromTuples
} from "@/components/panels/ShotBoardPanel";
import { Metric } from "@/components/layout/topbar-slots";
import { useDashboard } from "@/dashboard-context";

function SectionHeader({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-3">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {eyebrow}
      </span>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </header>
  );
}

function SubmitBanner({
  message,
  onDismiss
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-6 flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss banner"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-emerald-700 transition-colors hover:bg-emerald-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function OverviewPage() {
  const ctx = useDashboard();
  const {
    snapshot,
    projects,
    activeProjectId,
    blenderSession,
    tools,
    QUICK_OPS,
    opStates,
    actions,
    loading,
    operations,
    opsScopeActive,
    setOpsScopeActive,
    submitBanner,
    setSubmitBanner,
    approvalsRefreshTick,
    handleConnectBlender,
    handleListTools,
    handleRunProductVizDemo,
    handleRunQuickOp
  } = ctx;

  return (
    <>
      {submitBanner ? (
        <SubmitBanner
          message={submitBanner}
          onDismiss={() => setSubmitBanner(null)}
        />
      ) : null}

      <section
        className="mb-6 grid grid-cols-2 gap-3 lg:hidden lg:grid-cols-4"
        aria-label="Production metrics"
      >
        <Metric label="Progress" value={snapshot.metrics.progress} tone="good" />
        <Metric label="Blockers" value={snapshot.metrics.blockers} tone="warn" />
        <Metric label="Assets" value={snapshot.metrics.assets} />
        <Metric label="Review" value={snapshot.metrics.review} />
      </section>

      <div className="columns-1 gap-x-6 lg:columns-2">
        <section
          id="projects"
          className="mb-6 break-inside-avoid rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader
            eyebrow="PROJECTS"
            title="Projects"
            description="Projects stored in the local sidecar."
          />
          {projects.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-white px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">No projects yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a project from the home screen to start a pipeline.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {projects.map((project) => (
                <li key={project.id}>
                  <article className="rounded-md border border-border bg-white px-3 py-2">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {project.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Updated {new Date(project.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      {project.id === activeProjectId ? (
                        <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          Active
                        </span>
                      ) : null}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>

        <BriefPanel items={snapshot.brief} className="mb-6 break-inside-avoid" />

        <ProductionBoardPanel
          items={snapshot.board}
          className="mb-6 break-inside-avoid"
        />

        <ShotBoardPanel
          shots={shotsFromTuples(snapshot.shots)}
          className="mb-6 break-inside-avoid"
        />

        <BlenderSessionPanel
          session={blenderSession}
          tools={tools}
          ops={QUICK_OPS}
          opStates={opStates}
          actions={{
            connect: actions.connect,
            tools: actions.tools,
            demo: actions.demo
          }}
          loading={loading}
          onConnect={() => void handleConnectBlender()}
          onListTools={() => void handleListTools()}
          onRunDemo={() => void handleRunProductVizDemo()}
          onRunOp={(op) => void handleRunQuickOp(op)}
          className="mb-6 break-inside-avoid"
        />

        <PipelineRunsPanel
          activeProjectId={activeProjectId}
          className="mb-6 break-inside-avoid"
        />

        <ReviewPanel
          activeProjectId={activeProjectId}
          refreshTick={approvalsRefreshTick}
          className="mb-6 break-inside-avoid"
        />

        <section
          id="assets"
          className="mb-6 break-inside-avoid rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader
            eyebrow="ASSETS"
            title="Asset library"
            description="Search procedural recipes and external libraries."
          />
          <AssetsSearchPanel />
        </section>

        <OperationsPanel
          operations={operations}
          scope={opsScopeActive ? "active" : "all"}
          hasActiveProject={Boolean(activeProjectId)}
          loading={loading && operations.length === 0}
          onScopeChange={(next) => setOpsScopeActive(next === "active")}
          className="mb-6 break-inside-avoid"
        />
      </div>
    </>
  );
}
