import { useEffect } from "react";
import { Navigate, Outlet, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { useTopbarSlots } from "@/components/layout/topbar-slots";
import { useDashboard } from "@/dashboard-context";

/**
 * Layout for /projects/:projectId/* routes. Renders AppShell with the
 * sidebar on the left and an <Outlet /> on the right. Syncs URL ->
 * activeProjectId via setActiveProject.
 */
export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const {
    projects,
    projectsLoading,
    projectsError,
    activeProjectId,
    handleSelectProject
  } = useDashboard();
  const { projectPicker, topbarMetrics, apiStatus, topbarActions } =
    useTopbarSlots();

  // Sync the URL projectId into context if it differs.
  useEffect(() => {
    if (!projectId) return;
    if (projectId === activeProjectId) return;
    if (!projects.some((p) => p.id === projectId)) return;
    void handleSelectProject(projectId);
  }, [projectId, activeProjectId, projects, handleSelectProject]);

  // While projects are still loading, render the shell so the topbar shows.
  if (projectsLoading) {
    return (
      <AppShell
        projectPicker={projectPicker}
        topbarMetrics={topbarMetrics}
        topbarActions={topbarActions}
        apiStatus={apiStatus}
        disableContentContainer
      >
        <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
          Loading project…
        </div>
      </AppShell>
    );
  }

  if (projectsError) {
    return (
      <AppShell
        projectPicker={projectPicker}
        topbarMetrics={topbarMetrics}
        topbarActions={topbarActions}
        apiStatus={apiStatus}
        disableContentContainer
      >
        <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
          {projectsError}
        </div>
      </AppShell>
    );
  }

  // If the URL points to a project that doesn't exist, redirect to landing.
  if (projectId && !projects.some((p) => p.id === projectId)) {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell
      projectPicker={projectPicker}
      topbarMetrics={topbarMetrics}
      topbarActions={topbarActions}
      apiStatus={apiStatus}
      disableContentContainer
    >
      <div className="flex h-full">
        <ProjectSidebar />
        <div className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
            <Outlet />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
