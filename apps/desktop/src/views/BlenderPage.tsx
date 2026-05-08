import { BlenderSessionPanel } from "@/components/panels/BlenderSessionPanel";
import { RecentRendersPanel } from "@/components/panels/RecentRendersPanel";
import { SceneStatePanel } from "@/components/panels/SceneStatePanel";
import { useDashboard } from "@/dashboard-context";

export function BlenderPage() {
  const ctx = useDashboard();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Blender workspace</h1>
        <p className="text-sm text-muted-foreground">
          Connect, list MCP tools, and run typed operations.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <BlenderSessionPanel
          session={ctx.blenderSession}
          tools={ctx.tools}
          ops={ctx.QUICK_OPS}
          opStates={ctx.opStates}
          actions={{
            connect: ctx.actions.connect,
            tools: ctx.actions.tools,
            demo: ctx.actions.demo
          }}
          loading={ctx.loading}
          onConnect={() => void ctx.handleConnectBlender()}
          onListTools={() => void ctx.handleListTools()}
          onRunDemo={() => void ctx.handleRunProductVizDemo()}
          onRunOp={(op) => void ctx.handleRunQuickOp(op)}
        />
        <SceneStatePanel enabled={true} />
      </div>
      <RecentRendersPanel operations={ctx.operations} loading={ctx.loading} />
    </div>
  );
}
