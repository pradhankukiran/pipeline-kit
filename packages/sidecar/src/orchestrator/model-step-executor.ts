import type { PipelineStepContext, PipelineStepExecutor, ModelProvider } from "../providers/types.js";

export class ModelStepExecutor implements PipelineStepExecutor {
  readonly lane: ModelProvider["lane"];

  private readonly provider: ModelProvider;

  constructor(provider: ModelProvider) {
    this.provider = provider;
    this.lane = provider.lane;
  }

  async execute(context: PipelineStepContext): Promise<unknown> {
    const response = await this.provider.complete({
      responseFormat: context.step.metadata?.["responseFormat"] === "json" ? "json" : "text",
      messages: [
        {
          role: "system",
          content: "You are a PipelineKit sidecar provider. Return only the requested output."
        },
        {
          role: "user",
          content: [
            `Project prompt: ${context.input.prompt}`,
            `Step instruction: ${context.step.instruction}`,
            `Prior outputs: ${JSON.stringify(Object.fromEntries(context.priorOutputs))}`
          ].join("\n\n")
        }
      ]
    });

    if (context.step.metadata?.["responseFormat"] === "json") {
      return JSON.parse(response.content) as unknown;
    }

    return response.content;
  }
}
