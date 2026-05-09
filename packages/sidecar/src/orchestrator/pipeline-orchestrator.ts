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

export interface PipelineOrchestratorRunOptions {
  /**
   * When provided, the orchestrator stops dispatching new steps after the
   * signal aborts, marks every still-pending step as `cancelled`, and emits
   * `pipeline.cancelled` (instead of `pipeline.completed`). In-flight steps
   * resolve naturally — there is no safe way to interrupt a running bpy call
   * mid-execution.
   */
  readonly signal?: AbortSignal;
  /**
   * Pre-seeded outputs for steps treated as already-completed. Keys are step
   * IDs whose values become both the corresponding `priorOutputs` entry and
   * the seeded `succeeded` step result. Used by `rerunPipelineFromStep` so a
   * partial replay starts from a chosen step without re-running its
   * predecessors.
   */
  readonly seededOutputs?: ReadonlyMap<string, unknown>;
}

export class PipelineOrchestrator {
  private readonly executors: ReadonlyMap<ProviderLane, PipelineStepExecutor>;
  private readonly eventSink?: PipelineEventSink;

  constructor(options: PipelineOrchestratorOptions) {
    this.executors = new Map(options.executors.map((executor) => [executor.lane, executor]));
    this.eventSink = options.eventSink;
  }

  async run(
    definition: PipelineDefinition,
    opts?: PipelineOrchestratorRunOptions
  ): Promise<readonly PipelineStepResult[]> {
    const results: PipelineStepResult[] = [];
    const outputs = new Map<string, unknown>();
    const completed = new Set<string>();
    const failed = new Set<string>();
    const remaining = new Map(definition.steps.map((step) => [step.id, step]));
    const signal = opts?.signal;

    await this.publish({ type: "pipeline.started", pipelineId: definition.id });

    // Pre-seed outputs from a previous run — emit synthetic step.completed
    // events so SSE consumers see a consistent stream and treat the seeded
    // steps as having succeeded.
    if (opts?.seededOutputs && opts.seededOutputs.size > 0) {
      for (const step of definition.steps) {
        if (!opts.seededOutputs.has(step.id)) {
          continue;
        }
        const output = opts.seededOutputs.get(step.id);
        const result: PipelineStepResult = {
          stepId: step.id,
          lane: step.lane,
          status: "succeeded",
          output,
          summary: "Seeded from a previous run."
        };
        results.push(result);
        outputs.set(step.id, output);
        completed.add(step.id);
        remaining.delete(step.id);
        await this.publish({ type: "step.completed", pipelineId: definition.id, result });
      }
    }

    while (remaining.size > 0) {
      if (signal?.aborted) {
        return await this.cancelRemaining(definition, remaining, results);
      }

      const runnable = [...remaining.values()].filter((step) =>
        this.dependenciesSatisfied(step, completed)
      );

      if (runnable.length === 0) {
        throw new Error("Pipeline has unsatisfied or circular step dependencies.");
      }

      for (const step of runnable) {
        // Re-check before each dispatch — long-running steps may abort
        // between scheduling decisions inside the same tick.
        if (signal?.aborted) {
          return await this.cancelRemaining(definition, remaining, results);
        }

        const result = this.hasFailedDependency(step, failed)
          ? await this.skipStep(definition, step)
          : await this.runStep(definition, step, outputs, signal);
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
    priorOutputs: ReadonlyMap<string, unknown>,
    signal: AbortSignal | undefined
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
        priorOutputs,
        ...(signal ? { signal } : {})
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

  /**
   * Marks every still-pending step as `cancelled`, emits
   * `pipeline.cancelled`, and returns the accumulated results so far. Called
   * when the run's `AbortSignal` fires between scheduling ticks. Already-
   * running step promises continue to resolve via `runStep` and their normal
   * `step.completed` events (the cancellation only stops new dispatches).
   */
  private async cancelRemaining(
    definition: PipelineDefinition,
    remaining: ReadonlyMap<string, PipelineStep>,
    results: PipelineStepResult[]
  ): Promise<readonly PipelineStepResult[]> {
    for (const step of remaining.values()) {
      const result: PipelineStepResult = {
        stepId: step.id,
        lane: step.lane,
        status: "cancelled",
        summary: "Pipeline cancelled before this step ran."
      };
      results.push(result);
      await this.publish({ type: "step.completed", pipelineId: definition.id, result });
    }

    await this.publish({
      type: "pipeline.cancelled",
      pipelineId: definition.id,
      cancelledAt: new Date().toISOString()
    });

    return results;
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
