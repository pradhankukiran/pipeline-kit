import type {
  ModelProvider,
  PipelineStepContext,
  PipelineStepExecutor,
  ProviderImageInput
} from "../providers/types.js";

export class ModelStepExecutor implements PipelineStepExecutor {
  readonly lane: ModelProvider["lane"];

  private readonly provider: ModelProvider;

  constructor(provider: ModelProvider) {
    this.provider = provider;
    this.lane = provider.lane;
  }

  async execute(context: PipelineStepContext): Promise<unknown> {
    const images = collectStepImages(context);

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
      ],
      ...(images.length > 0 ? { images } : {})
    });

    if (context.step.metadata?.["responseFormat"] === "json") {
      return JSON.parse(response.content) as unknown;
    }

    return response.content;
  }
}

/**
 * Reads `step.metadata.images` and projects valid entries onto
 * `ProviderImageInput`. An entry is valid if it has at least a non-empty
 * `localPath` or `url` string. Invalid entries are skipped with a stderr
 * warning so a malformed metadata blob doesn't abort the pipeline run —
 * the provider call may still produce a useful response without them.
 */
function collectStepImages(context: PipelineStepContext): ReadonlyArray<ProviderImageInput> {
  const raw = context.step.metadata?.["images"];
  if (!Array.isArray(raw)) {
    return [];
  }

  const images: ProviderImageInput[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!isPlainRecord(entry)) {
      writeImageWarning(context.step.id, index, "entry is not an object");
      continue;
    }

    const localPath = isNonEmptyString(entry["localPath"]) ? entry["localPath"] : undefined;
    const url = isNonEmptyString(entry["url"]) ? entry["url"] : undefined;
    if (!localPath && !url) {
      writeImageWarning(context.step.id, index, "missing both localPath and url");
      continue;
    }

    const mediaType = isNonEmptyString(entry["mediaType"]) ? entry["mediaType"] : undefined;
    images.push({
      ...(localPath ? { localPath } : {}),
      ...(url ? { url } : {}),
      ...(mediaType ? { mediaType } : {})
    });
  }
  return images;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function writeImageWarning(stepId: string, index: number, reason: string): void {
  process.stderr.write(
    `[pipelinekit-sidecar] step ${stepId} image[${index}] skipped: ${reason}\n`
  );
}
