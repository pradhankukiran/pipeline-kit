import { useState } from "react";
import { AlertCircle, ChevronRight, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetupChecklist } from "./SetupChecklist";
import type { ProjectRecord } from "@/sidecarApi";

export interface WelcomeProps {
  projects: ProjectRecord[];
  onCreateProject: (name: string) => Promise<void> | void;
  onSelectProject: (id: string) => void;
  // setup checklist data
  sidecarConnected: boolean;
  blenderConnected: boolean;
  blenderConnecting: boolean;
  groqConfigured: boolean;
  openRouterConfigured: boolean;
  onOpenSettings: () => void;
  onConnectBlender: () => void;
  sidecarUrl: string;
}

export function Welcome(props: WelcomeProps) {
  const {
    projects,
    onCreateProject,
    onSelectProject,
    sidecarConnected,
    blenderConnected,
    blenderConnecting,
    groqConfigured,
    openRouterConfigured,
    onOpenSettings,
    onConnectBlender,
    sidecarUrl,
  } = props;

  const hasProjects = projects.length > 0;
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreateProject(trimmed);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-60px)] items-center justify-center px-6 py-12">
      <div className="grid w-full max-w-5xl items-start gap-8 lg:grid-cols-2">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Welcome to PipelineKit
            </h1>
            <p className="mt-3 text-base text-muted-foreground">
              AI-orchestrated Blender production pipelines. Render product
              visualizations, lighting setups, and turntables with typed
              operations.
            </p>
          </div>

          {hasProjects ? (
            <Card>
              <CardHeader>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  YOUR PROJECTS
                </p>
                <CardTitle className="text-base font-semibold">
                  {projects.length} project{projects.length === 1 ? "" : "s"}
                </CardTitle>
                <CardDescription>
                  Open a project to continue or create a new one below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      className="group flex items-center gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent/30 hover:border-foreground/15"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {project.name}
                        </p>
                        {project.description ? (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {project.description}
                          </p>
                        ) : null}
                      </div>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                        aria-hidden
                      />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {hasProjects ? "NEW PROJECT" : "GET STARTED"}
              </p>
              <CardTitle className="text-base font-semibold">
                {hasProjects ? "Create a new project" : "Create your first project"}
              </CardTitle>
              <CardDescription>
                Give it a name to start configuring shots, lighting, and renders.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
              >
                <div className="flex flex-col gap-2 text-left">
                  <Label htmlFor="welcome-project-name">Project name</Label>
                  <Input
                    id="welcome-project-name"
                    autoFocus={!hasProjects}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Hero water bottle"
                    disabled={submitting}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSubmit();
                      }
                    }}
                  />
                </div>

                {error ? (
                  <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-left">
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                      aria-hidden
                    />
                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-medium text-destructive">
                        Could not create project
                      </p>
                      <p className="text-xs text-muted-foreground">{error}</p>
                    </div>
                  </div>
                ) : null}

                <Button type="submit" disabled={!canSubmit}>
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Creating…
                    </>
                  ) : (
                    "Create project"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Setup checklist */}
        <SetupChecklist
          sidecarConnected={sidecarConnected}
          blenderConnected={blenderConnected}
          blenderConnecting={blenderConnecting}
          groqConfigured={groqConfigured}
          openRouterConfigured={openRouterConfigured}
          onOpenSettings={onOpenSettings}
          onConnectBlender={onConnectBlender}
          sidecarUrl={sidecarUrl}
        />
      </div>
    </div>
  );
}
