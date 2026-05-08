import type {
  PipelineDefinition,
  PipelineEventSink,
  PipelineStep,
  PipelineStepResult,
  ProviderLane
} from "../contracts.js";
import type { PipelineStepExecutor } from "../providers/types.js";

export interface PipelineOrchestratorOptions {
  readonly executors: readonly PipelineStepExecutor[];
  readonly eventSink?: PipelineEventSink;
}

export class PipelineOrchestrator {
  private readonly executors: ReadonlyMap<ProviderLane, PipelineStepExecutor>;
  private readonly eventSink?: PipelineEventSink;

  constructor(options: PipelineOrchestratorOptions) {
    this.executors = new Map(options.executors.map((executor) => [executor.lane, executor]));
    this.eventSink = options.eventSink;
  }

  async run(definition: PipelineDefinition): Promise<readonly PipelineStepResult[]> {
    const results: PipelineStepResult[] = [];
    const outputs = new Map<string, unknown>();
    const completed = new Set<string>();
    const failed = new Set<string>();
    const remaining = new Map(definition.steps.map((step) => [step.id, step]));

    await this.publish({ type: "pipeline.started", pipelineId: definition.id });

    while (remaining.size > 0) {
      const runnable = [...remaining.values()].filter((step) =>
        this.dependenciesSatisfied(step, completed)
      );

      if (runnable.length === 0) {
        throw new Error("Pipeline has unsatisfied or circular step dependencies.");
      }

      for (const step of runnable) {
        const result = this.hasFailedDependency(step, failed)
          ? await this.skipStep(definition, step)
          : await this.runStep(definition, step, outputs);
        results.push(result);
        remaining.delete(step.id);
        completed.add(step.id);

        if (result.status === "succeeded") {
          outputs.set(step.id, result.output);
        } else if (result.status === "failed") {
          failed.add(step.id);
        }
      }
    }

    await this.publish({
      type: "pipeline.completed",
      pipelineId: definition.id,
      results
    });

    return results;
  }

  private async runStep(
    definition: PipelineDefinition,
    step: PipelineStep,
    priorOutputs: ReadonlyMap<string, unknown>
  ): Promise<PipelineStepResult> {
    const executor = this.executors.get(step.lane);
    if (!executor) {
      throw new Error(`No executor registered for lane "${step.lane}".`);
    }

    await this.publish({ type: "step.started", pipelineId: definition.id, step });

    try {
      const output = await executor.execute({
        input: definition.input,
        step,
        priorOutputs
      });
      const result: PipelineStepResult = {
        stepId: step.id,
        lane: step.lane,
        status: "succeeded",
        output
      };
      await this.publish({ type: "step.completed", pipelineId: definition.id, result });
      return result;
    } catch (error) {
      const result: PipelineStepResult = {
        stepId: step.id,
        lane: step.lane,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      };
      await this.publish({ type: "step.completed", pipelineId: definition.id, result });
      return result;
    }
  }

  private async skipStep(
    definition: PipelineDefinition,
    step: PipelineStep
  ): Promise<PipelineStepResult> {
    const result: PipelineStepResult = {
      stepId: step.id,
      lane: step.lane,
      status: "skipped",
      error: "Skipped because a dependency failed."
    };
    await this.publish({ type: "step.completed", pipelineId: definition.id, result });
    return result;
  }

  private dependenciesSatisfied(step: PipelineStep, completed: ReadonlySet<string>): boolean {
    return (step.dependsOn ?? []).every((stepId) => completed.has(stepId));
  }

  private hasFailedDependency(step: PipelineStep, failed: ReadonlySet<string>): boolean {
    return (step.dependsOn ?? []).some((stepId) => failed.has(stepId));
  }

  private async publish(event: Parameters<PipelineEventSink["publish"]>[0]): Promise<void> {
    await this.eventSink?.publish(event);
  }
}
