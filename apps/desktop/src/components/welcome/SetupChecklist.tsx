import * as React from "react";
import {
  Check,
  Circle,
  Loader2,
  Plug,
  Settings,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface SetupChecklistProps {
  sidecarConnected: boolean;
  blenderConnected: boolean;
  blenderConnecting: boolean;
  groqConfigured: boolean;
  openRouterConfigured: boolean;
  onOpenSettings: () => void;
  onConnectBlender: () => void;
  sidecarUrl: string;
  className?: string;
}

type RowStatus = "done" | "required-missing" | "recommended-missing" | "in-progress";

interface ChecklistRowProps {
  status: RowStatus;
  title: string;
  subtitle: string;
  /**
   * Right-side slot. Kept flexible so each row can render its own
   * combination of buttons / hint text / monospace url.
   */
  right?: React.ReactNode;
}

function StatusIcon({ status }: { status: RowStatus }) {
  switch (status) {
    case "done":
      return <Check className="h-5 w-5 text-emerald-600" aria-hidden />;
    case "in-progress":
      return (
        <Loader2
          className="h-5 w-5 animate-spin text-muted-foreground"
          aria-hidden
        />
      );
    case "recommended-missing":
      return <Circle className="h-5 w-5 text-amber-600" aria-hidden />;
    case "required-missing":
    default:
      return (
        <Circle className="h-5 w-5 text-muted-foreground/40" aria-hidden />
      );
  }
}

function ChecklistRow({ status, title, subtitle, right }: ChecklistRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        <StatusIcon status={status} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {right ? (
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      ) : null}
    </div>
  );
}

export function SetupChecklist(props: SetupChecklistProps) {
  const {
    sidecarConnected,
    blenderConnected,
    blenderConnecting,
    groqConfigured,
    openRouterConfigured,
    onOpenSettings,
    onConnectBlender,
    sidecarUrl,
    className,
  } = props;

  // Row 1: Sidecar (always required, but no in-app fix).
  const sidecarRow = sidecarConnected ? (
    <ChecklistRow
      key="sidecar"
      status="done"
      title="Sidecar online"
      subtitle="Local sidecar reachable and ready."
      right={
        <span className="font-mono text-[11px] text-muted-foreground">
          {sidecarUrl}
        </span>
      }
    />
  ) : (
    <ChecklistRow
      key="sidecar"
      status="required-missing"
      title="Sidecar offline"
      subtitle="Start the local sidecar so the app can talk to Blender and the planner."
      right={
        <span className="text-xs text-muted-foreground">Start it manually</span>
      }
    />
  );

  // Row 2: Blender (optional-but-recommended; has connecting state).
  let blenderRow: React.ReactNode;
  if (blenderConnected) {
    blenderRow = (
      <ChecklistRow
        key="blender"
        status="done"
        title="Blender connected"
        subtitle="MCP bridge active and tools loaded."
        right={<span className="text-xs text-muted-foreground">Ready</span>}
      />
    );
  } else if (blenderConnecting) {
    blenderRow = (
      <ChecklistRow
        key="blender"
        status="in-progress"
        title="Connect Blender"
        subtitle="Spawn the local MCP bridge to drive scenes via typed ops."
        right={
          <Button variant="outline" size="sm" disabled>
            <Loader2 className="animate-spin" />
            Connecting…
          </Button>
        }
      />
    );
  } else {
    blenderRow = (
      <ChecklistRow
        key="blender"
        status="recommended-missing"
        title="Connect Blender"
        subtitle="Spawn the local MCP bridge to drive scenes via typed ops."
        right={
          <Button variant="outline" size="sm" onClick={onConnectBlender}>
            <Plug />
            Connect
          </Button>
        }
      />
    );
  }

  // Row 3: Groq (required for the planner).
  const groqRow = groqConfigured ? (
    <ChecklistRow
      key="groq"
      status="done"
      title="Groq API key set"
      subtitle="Planner can route work end-to-end."
      right={<span className="text-xs text-muted-foreground">Ready</span>}
    />
  ) : (
    <ChecklistRow
      key="groq"
      status="required-missing"
      title="Add a Groq API key"
      subtitle="Required for the planner to generate real DAGs from prompts."
      right={
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <Settings />
          Open settings
        </Button>
      }
    />
  );

  // Row 4: OpenRouter (recommended, not required).
  const openRouterRow = openRouterConfigured ? (
    <ChecklistRow
      key="openrouter"
      status="done"
      title="OpenRouter API key set"
      subtitle="Vision review lane ready."
      right={<span className="text-xs text-muted-foreground">Ready</span>}
    />
  ) : (
    <ChecklistRow
      key="openrouter"
      status="recommended-missing"
      title="Add an OpenRouter API key"
      subtitle="Recommended for creative direction and review steps."
      right={
        <Button variant="ghost" size="sm" onClick={onOpenSettings}>
          Add
        </Button>
      }
    />
  );

  const rows = [sidecarRow, blenderRow, groqRow, openRouterRow];

  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex flex-col gap-2 px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          SETUP CHECKLIST
        </p>
        <p className="text-xs text-muted-foreground">
          Get the connections in place before kicking off a pipeline.
        </p>
      </div>
      <Separator />
      <div className="flex flex-col">
        {rows.map((row, index) => (
          <React.Fragment key={index}>
            {index > 0 ? <Separator /> : null}
            {row}
          </React.Fragment>
        ))}
      </div>
    </Card>
  );
}
