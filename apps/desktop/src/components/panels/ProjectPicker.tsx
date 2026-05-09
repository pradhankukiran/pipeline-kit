import { useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  FolderPlus,
  Loader2,
  Plus,
  Upload,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ProjectRecord } from "@/sidecarApi";

export interface ProjectPickerProps {
  projects: ProjectRecord[];
  currentProjectId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreateRequested: () => void;
  onExportRequested?: () => void;
  onImportRequested?: () => void;
  exportBusy?: boolean;
  importBusy?: boolean;
}

export function ProjectPicker({
  projects,
  currentProjectId,
  loading,
  onSelect,
  onCreateRequested,
  onExportRequested,
  onImportRequested,
  exportBusy = false,
  importBusy = false,
}: ProjectPickerProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const current = projects.find((p) => p.id === currentProjectId) ?? null;
  const showSkeleton = loading && projects.length === 0;

  function handleSelect(id: string) {
    onSelect(id);
    setMenuOpen(false);
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="-ml-2 h-9 gap-2 px-2 hover:bg-secondary"
          aria-label="Select project"
        >
          {showSkeleton ? (
            <Skeleton className="h-5 w-40" />
          ) : current ? (
            <span className="truncate text-base font-semibold tracking-tight">
              {current.name}
            </span>
          ) : (
            <span className="truncate text-base font-medium text-muted-foreground">
              Select a project
            </span>
          )}
          <ChevronDown className="shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[16rem]">
        {projects.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
            <FolderPlus className="h-4 w-4" aria-hidden />
            <span>No projects yet</span>
          </div>
        ) : (
          projects.map((project) => {
            const isActive = project.id === currentProjectId;
            return (
              <DropdownMenuItem
                key={project.id}
                role="menuitemradio"
                aria-checked={isActive}
                onSelect={(event) => {
                  event.preventDefault();
                  handleSelect(project.id);
                }}
                className={cn(
                  "gap-3 px-2 py-2 text-sm",
                  isActive && "bg-accent/50"
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{project.name}</span>
                  {project.description ? (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {project.description}
                    </span>
                  ) : null}
                </div>
                {isActive ? (
                  <Check className="ml-auto shrink-0" aria-hidden />
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setMenuOpen(false);
            onCreateRequested();
          }}
          className="gap-2 px-2 py-2 text-sm"
        >
          <Plus aria-hidden />
          <span>Create new project…</span>
        </DropdownMenuItem>
        {onExportRequested ? (
          <DropdownMenuItem
            disabled={!current || exportBusy}
            onSelect={(event) => {
              event.preventDefault();
              if (!current || exportBusy) return;
              setMenuOpen(false);
              onExportRequested();
            }}
            className="gap-2 px-2 py-2 text-sm"
          >
            {exportBusy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            <span>{exportBusy ? "Exporting…" : "Export current project"}</span>
          </DropdownMenuItem>
        ) : null}
        {onImportRequested ? (
          <DropdownMenuItem
            disabled={importBusy}
            onSelect={(event) => {
              event.preventDefault();
              if (importBusy) return;
              setMenuOpen(false);
              onImportRequested();
            }}
            className="gap-2 px-2 py-2 text-sm"
          >
            {importBusy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Upload aria-hidden />
            )}
            <span>{importBusy ? "Importing…" : "Import project…"}</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
