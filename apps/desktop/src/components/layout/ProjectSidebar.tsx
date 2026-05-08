import {
  Box,
  Image as ImageIcon,
  LayoutDashboard,
  ListOrdered,
  MessageSquare
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { Separator } from "@/components/ui/separator";
import { useDashboard } from "@/dashboard-context";
import { cn } from "@/lib/utils";

type SidebarItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ITEMS: SidebarItem[] = [
  { to: "overview", label: "Overview", icon: LayoutDashboard },
  { to: "blender", label: "Blender", icon: Box },
  { to: "runs", label: "Pipeline runs", icon: ListOrdered },
  { to: "review", label: "Review", icon: MessageSquare },
  { to: "assets", label: "Assets", icon: ImageIcon }
];

export function ProjectSidebar() {
  const { projects, activeProjectId } = useDashboard();
  const project = projects.find((p) => p.id === activeProjectId);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-white">
      <div className="px-4 pt-4 pb-3">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          PROJECT
        </span>
        <span className="mt-1 block truncate text-sm font-semibold text-foreground">
          {project?.name ?? "Select a project"}
        </span>
      </div>
      <Separator />
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-secondary font-medium text-foreground"
                    : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
