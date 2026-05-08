import { Outlet } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { useTopbarSlots } from "@/components/layout/topbar-slots";

/**
 * Top-level layout used for routes outside of a specific project
 * (e.g. /welcome and the redirect index). Renders AppShell + Outlet.
 * No sidebar.
 */
export function Layout() {
  const { projectPicker, topbarMetrics, apiStatus, topbarActions } =
    useTopbarSlots();

  return (
    <AppShell
      projectPicker={projectPicker}
      topbarMetrics={topbarMetrics}
      topbarActions={topbarActions}
      apiStatus={apiStatus}
    >
      <Outlet />
    </AppShell>
  );
}
