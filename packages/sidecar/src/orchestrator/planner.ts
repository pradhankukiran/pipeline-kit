import { createWaterBottleProductVizDemoOperations, validateBlenderOperation } from "@pipelinekit/core";
import type { PipelineDefinition, PipelineStep, ProviderLane } from "../contracts.js";
import { createGroqProvider } from "../providers/groq.js";
import type { SidecarSettings } from "../server/state.js";

const PLANNER_TIMEOUT_MS = 60_000;
const VALID_LANES: readonly ProviderLane[] = ["groq", "openrouter", "codex", "blender"];

const PLANNER_SYSTEM_PROMPT = `You are PipelineKit's planner. The user wants a Blender-based creative pipeline.
Output ONLY valid JSON matching this schema:
{"steps": [{"id": "kebab-case-string", "lane": "groq"|"openrouter"|"codex"|"blender", "instruction": "string", "dependsOn": ["string"], "metadata": {}}]}

Rules:
- 3-7 steps total. Each step ID is unique kebab-case (e.g. "plan-shot", "render-hero").
- dependsOn references earlier step IDs and forms a DAG (no cycles).
- Use groq for fast structured planning/validation/summary.
- Use openrouter for creative direction or vision review.
- Use codex sparingly for complex tool-heavy production work.
- Use blender for actual scene/render operations.
- Final step should summarize the run on a non-blender lane.
- Non-blender lanes (groq/openrouter/codex) use plain "instruction" only; "metadata" is optional.
- Blender lanes MUST emit a typed operation in metadata.operation (preferred) OR raw bpy in metadata.python (fallback). If neither fits cleanly, omit both — the orchestrator will translate the instruction at execution time.

BlenderOperation types — emit metadata.operation as exactly one of these shapes. Each MUST include: id (kebab-case string), projectId (string, use "active" if unknown), type, params, risk ("low"|"medium"|"high"), requiresApproval (boolean), createdAt (ISO 8601 string).

1. type: "create_scene"
   params: { sceneName: string, units: "metric"|"imperial", clearExisting: boolean }

2. type: "create_studio_set"
   params: { recipeId: "product_sweep"|"water_bottle_product_viz"|"pedestal", scale: number(0,100], variant?: string }

3. type: "apply_material"
   params: { targetObject: string, materialAssetId?: string, proceduralMaterialId?: "clear_plastic"|"frosted_plastic"|"brushed_aluminum"|"paper_label"|"matte_clay"|"glossy_white", color?: "#rrggbb", roughness?: number[0,1], metallic?: number[0,1], alpha?: number[0,1] }
   Constraint: at least one of materialAssetId | proceduralMaterialId.

4. type: "create_lighting_rig"
   params: { preset: "studio_softbox"|"high_key_product"|"dramatic_rim"|"three_point", colorTemperature: int[1000,20000], intensity: number>0, useHdri: boolean, hdriAssetId?: string }

5. type: "create_camera_rig"
   params: { shotLabel: string, focalLength: number[10,300], cameraMove?: "static"|"orbit"|"dolly"|"push_in", outputAspect: "1:1"|"4:5"|"16:9"|"9:16", targetObject?: string }

6. type: "render_shot"
   params: { shotId: string, quality: "preview"|"review"|"final", outputPath: string }

7. type: "inspect_scene"
   params: { includeObjects: boolean, includeMaterials: boolean, includeRenderSettings: boolean }

8. type: "save_checkpoint"
   params: { label: string, includeBlendFile: boolean }

Examples (return JSON exactly this shape, no prose, no code fences):

Example A — product render:
{"steps":[
  {"id":"brief","lane":"groq","instruction":"Extract product render brief from prompt."},
  {"id":"new-scene","lane":"blender","instruction":"Create a clean scene.","dependsOn":["brief"],"metadata":{"operation":{"id":"new-scene","projectId":"active","type":"create_scene","params":{"sceneName":"Hero","units":"metric","clearExisting":true},"risk":"low","requiresApproval":false,"createdAt":"1970-01-01T00:00:00.000Z"}}},
  {"id":"set-lighting","lane":"blender","instruction":"High-key product lighting.","dependsOn":["new-scene"],"metadata":{"operation":{"id":"set-lighting","projectId":"active","type":"create_lighting_rig","params":{"preset":"high_key_product","colorTemperature":5600,"intensity":1,"useHdri":false},"risk":"low","requiresApproval":false,"createdAt":"1970-01-01T00:00:00.000Z"}}},
  {"id":"hero-cam","lane":"blender","instruction":"Hero front camera.","dependsOn":["set-lighting"],"metadata":{"operation":{"id":"hero-cam","projectId":"active","type":"create_camera_rig","params":{"shotLabel":"Hero","focalLength":85,"cameraMove":"static","outputAspect":"4:5"},"risk":"low","requiresApproval":false,"createdAt":"1970-01-01T00:00:00.000Z"}}},
  {"id":"render","lane":"blender","instruction":"Preview render.","dependsOn":["hero-cam"],"metadata":{"operation":{"id":"render","projectId":"active","type":"render_shot","params":{"shotId":"hero","quality":"preview","outputPath":"//renders/hero.png"},"risk":"low","requiresApproval":false,"createdAt":"1970-01-01T00:00:00.000Z"}}},
  {"id":"summary","lane":"groq","instruction":"Summarize the run for the desktop UI.","dependsOn":["render"]}
]}

Example B — explore-then-render with vision review:
{"steps":[
  {"id":"direction","lane":"openrouter","instruction":"Propose creative direction for the prompt."},
  {"id":"inspect","lane":"blender","instruction":"Inspect current scene.","dependsOn":["direction"],"metadata":{"operation":{"id":"inspect","projectId":"active","type":"inspect_scene","params":{"includeObjects":true,"includeMaterials":true,"includeRenderSettings":true},"risk":"low","requiresApproval":false,"createdAt":"1970-01-01T00:00:00.000Z"}}},
  {"id":"checkpoint","lane":"blender","instruction":"Save checkpoint before changes.","dependsOn":["inspect"],"metadata":{"operation":{"id":"checkpoint","projectId":"active","type":"save_checkpoint","params":{"label":"pre-render","includeBlendFile":true},"risk":"low","requiresApproval":false,"createdAt":"1970-01-01T00:00:00.000Z"}}},
  {"id":"summary","lane":"groq","instruction":"Summarize.","dependsOn":["checkpoint"]}
]}

Return JSON ONLY, no prose, no markdown fences.`;

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
    const metadata = raw["metadata"];
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

    let normalizedMetadata: Record<string, unknown> | undefined;
    if (metadata !== undefined) {
      if (!isRecord(metadata)) return undefined;
      normalizedMetadata = {};
      // Pass-through known optional keys.
      if (metadata["python"] !== undefined) {
        if (typeof metadata["python"] !== "string") return undefined;
        normalizedMetadata["python"] = metadata["python"];
      }
      if (metadata["requiresApproval"] !== undefined) {
        normalizedMetadata["requiresApproval"] = metadata["requiresApproval"];
      }
      if (metadata["projectId"] !== undefined) {
        normalizedMetadata["projectId"] = metadata["projectId"];
      }
      if (metadata["images"] !== undefined) {
        normalizedMetadata["images"] = metadata["images"];
      }
      if (metadata["responseFormat"] !== undefined) {
        normalizedMetadata["responseFormat"] = metadata["responseFormat"];
      }

      // Strict typed-op validation for blender lanes.
      const operationCandidate = metadata["operation"];
      if (operationCandidate !== undefined) {
        if (lane !== "blender") {
          // Non-blender lanes shouldn't carry operation; ignore but don't reject.
        } else {
          try {
            const validated = validateBlenderOperation(operationCandidate);
            normalizedMetadata["operation"] = validated;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(
              `[pipelinekit-sidecar] planner step "${id}" produced invalid BlenderOperation: ${message}\n`
            );
            return undefined;
          }
        }
      }
    }

    const baseStep: PipelineStep = {
      id: id.trim(),
      lane: lane as ProviderLane,
      instruction: instruction.trim(),
      ...(deps ? { dependsOn: deps } : {}),
      ...(normalizedMetadata && Object.keys(normalizedMetadata).length > 0
        ? { metadata: normalizedMetadata }
        : {})
    };
    out.push(baseStep);
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
