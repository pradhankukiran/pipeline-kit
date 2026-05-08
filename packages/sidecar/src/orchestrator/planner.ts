import { createWaterBottleProductVizDemoOperations } from "@pipelinekit/core";
import type { PipelineDefinition, PipelineStep, ProviderLane } from "../contracts.js";
import { createGroqProvider } from "../providers/groq.js";
import type { SidecarSettings } from "../server/state.js";

const PLANNER_TIMEOUT_MS = 30_000;
const VALID_LANES: readonly ProviderLane[] = ["groq", "openrouter", "codex", "blender"];

const PLANNER_SYSTEM_PROMPT = `You are PipelineKit's planner. The user wants a Blender-based creative pipeline.
Output ONLY valid JSON matching this schema:
{"steps": [{"id": "string", "lane": "groq"|"openrouter"|"codex"|"blender", "instruction": "string", "dependsOn": ["string"]}]}
- 3-7 steps total.
- Use groq for fast structured planning/validation/summary.
- Use openrouter for creative direction or vision review.
- Use blender for actual scene/render operations (the blender lane runs ops via Blender MCP).
- Use codex sparingly, for complex tool-heavy production work.
- Last step should summarize the run.
- Step IDs must be unique kebab-case strings.
- dependsOn references other step IDs and forms a DAG (no cycles).
Return JSON ONLY, no prose.`;

export interface PlannerDeps {
  readonly settings: SidecarSettings;
}

export async function planPipelineFromPrompt(
  prompt: string,
  deps: PlannerDeps,
  pipelineId: string
): Promise<PipelineDefinition> {
  const settings = deps.settings;
  const apiKey =
    (settings.models as any).groqApiKey ??
    process.env["PIPELINEKIT_GROQ_API_KEY"] ??
    process.env["GROQ_API_KEY"] ??
    "";

  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return buildTemplatePipeline(prompt, pipelineId);
  }

  try {
    const provider = createGroqProvider({ apiKey, model: settings.models.groqModel });
    const response = await Promise.race([
      provider.complete({
        responseFormat: "json",
        temperature: 0.2,
        messages: [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ]
      }),
      timeoutAfter(PLANNER_TIMEOUT_MS)
    ]);

    const parsed = JSON.parse(response.content) as unknown;
    const steps = validatePlannerSteps(parsed);
    if (!steps) {
      throw new Error("planner response failed shape validation");
    }
    return {
      id: pipelineId,
      input: { prompt },
      steps: dedupeStepIds(steps)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[pipelinekit-sidecar] planner fallback (${message}); using template\n`);
    return buildTemplatePipeline(prompt, pipelineId);
  }
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`planner timed out after ${ms}ms`)), ms);
  });
}

function validatePlannerSteps(value: unknown): PipelineStep[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["steps"]) || value["steps"].length === 0) {
    return undefined;
  }
  const out: PipelineStep[] = [];
  for (const raw of value["steps"]) {
    if (!isRecord(raw)) return undefined;
    const id = raw["id"];
    const lane = raw["lane"];
    const instruction = raw["instruction"];
    const dependsOn = raw["dependsOn"];
    if (typeof id !== "string" || id.trim().length === 0) return undefined;
    if (typeof lane !== "string" || !(VALID_LANES as readonly string[]).includes(lane)) return undefined;
    if (typeof instruction !== "string" || instruction.trim().length === 0) return undefined;
    let deps: readonly string[] | undefined;
    if (dependsOn !== undefined) {
      if (!Array.isArray(dependsOn) || !dependsOn.every((d): d is string => typeof d === "string")) {
        return undefined;
      }
      deps = dependsOn;
    }
    const step: PipelineStep = deps
      ? { id: id.trim(), lane: lane as ProviderLane, instruction: instruction.trim(), dependsOn: deps }
      : { id: id.trim(), lane: lane as ProviderLane, instruction: instruction.trim() };
    out.push(step);
  }
  return out;
}

function dedupeStepIds(steps: readonly PipelineStep[]): PipelineStep[] {
  const seen = new Map<string, number>();
  const renamed = new Map<string, string>();
  const result: PipelineStep[] = [];
  for (const step of steps) {
    const baseId = step.id;
    let nextId = baseId;
    if (seen.has(baseId)) {
      const count = (seen.get(baseId) ?? 0) + 1;
      seen.set(baseId, count);
      nextId = `${baseId}-${count}`;
      while (seen.has(nextId)) {
        const c = (seen.get(nextId) ?? 0) + 1;
        nextId = `${baseId}-${c}`;
      }
      renamed.set(baseId, nextId);
    }
    seen.set(nextId, seen.get(nextId) ?? 0);
    const remappedDeps = step.dependsOn?.map((d) => renamed.get(d) ?? d);
    result.push(remappedDeps ? { ...step, id: nextId, dependsOn: remappedDeps } : { ...step, id: nextId });
  }
  return result;
}

export function buildTemplatePipeline(prompt: string, pipelineId: string): PipelineDefinition {
  const [firstOperation] = createWaterBottleProductVizDemoOperations({
    projectId: "demo",
    idPrefix: `prompt-${Date.now()}`,
    createdAt: new Date().toISOString()
  });

  return {
    id: pipelineId,
    input: {
      prompt,
      metadata: { source: "prompt-synth" }
    },
    steps: [
      {
        id: "plan",
        lane: "groq",
        instruction: "Plan a short product visualization for the prompt above.",
        metadata: { responseFormat: "json" }
      },
      {
        id: "execute",
        lane: "blender",
        instruction: "Execute the first Blender operation from the plan.",
        dependsOn: ["plan"],
        metadata: firstOperation ? { operation: firstOperation } : {}
      },
      {
        id: "summary",
        lane: "groq",
        instruction: "Summarize the run for the desktop UI in one paragraph.",
        dependsOn: ["execute"]
      }
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
