import type { PipelineDefinition } from "../contracts.js";

export const demoPipeline: PipelineDefinition = {
  id: "demo",
  input: {
    prompt: "Create a short product animation for a reusable water bottle.",
    metadata: {
      audience: "desktop-development"
    }
  },
  steps: [
    {
      id: "brief",
      lane: "groq",
      instruction: "Summarize the creative goal, tone, and constraints.",
      metadata: {
        responseFormat: "json"
      }
    },
    {
      id: "plan",
      lane: "openrouter",
      instruction: "Turn the brief into a three-shot production plan.",
      dependsOn: ["brief"]
    },
    {
      id: "scene",
      lane: "blender",
      instruction: "Prepare a placeholder scene description for Blender execution.",
      dependsOn: ["plan"]
    }
  ]
};
