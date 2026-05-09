import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PipelineSettings } from "@/fallbackData";

export interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: PipelineSettings;
  saving: boolean;
  disabled?: boolean;
  autoConnect: boolean;
  autoCheckpoint: boolean;
  approvalTimeoutSec: number;
  onAutoConnectChange: (value: boolean) => void;
  onAutoCheckpointChange: (value: boolean) => void;
  onApprovalTimeoutChange: (value: number) => void;
  onChange: (field: keyof PipelineSettings, value: string) => void;
  onSave: () => void | Promise<void>;
}

type RevealState = {
  groq: boolean;
  openRouter: boolean;
};

export function SettingsPanel({
  open,
  onOpenChange,
  settings,
  saving,
  disabled = false,
  autoConnect,
  autoCheckpoint,
  approvalTimeoutSec,
  onAutoConnectChange,
  onAutoCheckpointChange,
  onApprovalTimeoutChange,
  onChange,
  onSave,
}: SettingsPanelProps) {
  const [reveal, setReveal] = useState<RevealState>({ groq: false, openRouter: false });
  const [savedFlash, setSavedFlash] = useState(false);
  const [wasSaving, setWasSaving] = useState(false);

  useEffect(() => {
    if (saving) {
      setWasSaving(true);
      return;
    }
    if (wasSaving) {
      setWasSaving(false);
      setSavedFlash(true);
      const t = window.setTimeout(() => setSavedFlash(false), 2000);
      return () => window.clearTimeout(t);
    }
  }, [saving, wasSaving]);

  function toggleReveal(key: keyof RevealState) {
    setReveal((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4 pr-12">
          <DialogTitle className="text-base font-semibold tracking-tight">Settings</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Local sidecar configuration
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {/* Blender MCP */}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Blender MCP</h3>
              <p className="text-xs text-muted-foreground">
                Command and arguments used to spawn the local MCP bridge.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="settings-blender-cmd">Command</Label>
                <Input
                  id="settings-blender-cmd"
                  value={settings.blenderMcpCommand}
                  onChange={(event) => onChange("blenderMcpCommand", event.target.value)}
                  placeholder="blender-socket"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-blender-args">Args</Label>
                <Input
                  id="settings-blender-args"
                  value={settings.blenderMcpArgs}
                  onChange={(event) => onChange("blenderMcpArgs", event.target.value)}
                  placeholder="Leave empty for the Blender socket"
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Space-separated. Parsed into an array on save.
                </p>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2">
                <span className="flex flex-col">
                  <span className="text-sm font-medium">Auto-connect on launch</span>
                  <span className="text-xs text-muted-foreground">
                    Spawn the MCP bridge as soon as the desktop app starts.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={autoConnect}
                  onChange={(event) => onAutoConnectChange(event.target.checked)}
                  className="peer sr-only"
                  aria-label="Auto-connect on launch"
                />
                <span
                  aria-hidden
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-input transition-colors",
                    "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                    autoConnect && "bg-primary"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
                      autoConnect ? "translate-x-4" : "translate-x-0.5"
                    )}
                  />
                </span>
              </label>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2">
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    Auto-checkpoint after each Blender step
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Save a labeled checkpoint after every typed-op so you can
                    rewind individual steps without rerunning the pipeline.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={autoCheckpoint}
                  onChange={(event) =>
                    onAutoCheckpointChange(event.target.checked)
                  }
                  className="peer sr-only"
                  aria-label="Auto-checkpoint after each Blender step"
                />
                <span
                  aria-hidden
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-input transition-colors",
                    "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                    autoCheckpoint && "bg-primary"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
                      autoCheckpoint ? "translate-x-4" : "translate-x-0.5"
                    )}
                  />
                </span>
              </label>
            </div>
          </section>

          <Separator />

          {/* Approvals */}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Approvals</h3>
              <p className="text-xs text-muted-foreground">
                Auto-rejection policy for pending approvals.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-approval-timeout">
                Auto-reject pending approvals after (seconds)
              </Label>
              <Input
                id="settings-approval-timeout"
                type="number"
                min={0}
                step={1}
                value={
                  Number.isFinite(approvalTimeoutSec)
                    ? String(approvalTimeoutSec)
                    : "0"
                }
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  onApprovalTimeoutChange(
                    Number.isFinite(next) && next >= 0 ? next : 0
                  );
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Set to 0 to disable. The sidecar reads
                <code className="mx-1 font-mono">PIPELINEKIT_APPROVAL_TIMEOUT_MS</code>
                today; this value is persisted alongside other settings and
                will be picked up by a future sidecar release.
              </p>
            </div>
          </section>

          <Separator />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Groq */}
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-medium">Groq</h3>
                <p className="text-xs text-muted-foreground">
                  Draft lane model and credentials.
                </p>
              </div>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="settings-groq-model">Model</Label>
                  <Input
                    id="settings-groq-model"
                    value={settings.groqModel}
                    onChange={(event) => onChange("groqModel", event.target.value)}
                    placeholder="llama-3.3-70b-versatile"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="settings-groq-key">API key</Label>
                  <div className="relative">
                    <Input
                      id="settings-groq-key"
                      type={reveal.groq ? "text" : "password"}
                      value={settings.groqApiKey}
                      onChange={(event) => onChange("groqApiKey", event.target.value)}
                      placeholder="Not set"
                      spellCheck={false}
                      autoComplete="off"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleReveal("groq")}
                      className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
                      aria-label={reveal.groq ? "Hide Groq API key" : "Show Groq API key"}
                    >
                      {reveal.groq ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            {/* OpenRouter */}
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-medium">OpenRouter</h3>
                <p className="text-xs text-muted-foreground">
                  Review lane model and credentials.
                </p>
              </div>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="settings-openrouter-model">Model</Label>
                  <Input
                    id="settings-openrouter-model"
                    value={settings.openRouterModel}
                    onChange={(event) => onChange("openRouterModel", event.target.value)}
                    placeholder="anthropic/claude-3.5-sonnet"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="settings-openrouter-key">API key</Label>
                  <div className="relative">
                    <Input
                      id="settings-openrouter-key"
                      type={reveal.openRouter ? "text" : "password"}
                      value={settings.openRouterApiKey}
                      onChange={(event) => onChange("openRouterApiKey", event.target.value)}
                      placeholder="Not set"
                      spellCheck={false}
                      autoComplete="off"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleReveal("openRouter")}
                      className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
                      aria-label={
                        reveal.openRouter ? "Hide OpenRouter API key" : "Show OpenRouter API key"
                      }
                    >
                      {reveal.openRouter ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <DialogFooter className="shrink-0 items-center border-t border-border px-6 py-4">
          {savedFlash ? (
            <Badge variant="success" className="inline-flex items-center gap-1">
              <Check className="h-3 w-3 mr-1" aria-hidden />
              Saved
            </Badge>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Close
          </Button>
          <Button onClick={() => void onSave()} disabled={saving || disabled}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
