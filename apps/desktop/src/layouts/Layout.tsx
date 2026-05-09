import { Outlet } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { useHomeTopbarSlots } from "@/components/layout/topbar-slots";

/**
 * Top-level layout used for routes outside of a specific project
 * (e.g. /welcome and the redirect index). Renders AppShell + Outlet.
 * No sidebar.
 */
export function Layout() {
  const { apiStatus, topbarActions } = useHomeTopbarSlots();

  return (
    <AppShell
      topbarActions={topbarActions}
      apiStatus={apiStatus}
    >
      <Outlet />
    </AppShell>
  );
}
