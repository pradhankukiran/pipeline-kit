import { sidecarBaseUrl } from "./sidecarApi";

// Mirrors the discriminated union from packages/core/src/pipeline.ts.
// Kept loose (Record<string, unknown> for nested fields) so the desktop never
// pulls @pipelinekit/core types — those aren't bundled into the Vite build.
export type PipelineSseEvent =
  | { type: "pipeline.started"; pipelineId: string }
  | { type: "step.started"; pipelineId: string; step: { id: string; lane: string; metadata?: Record<string, unknown> } & Record<string, unknown> }
  | { type: "step.completed"; pipelineId: string; result: { stepId: string; lane: string; status: string; output?: unknown; error?: string } & Record<string, unknown> }
  | { type: "pipeline.completed"; pipelineId: string; results: ReadonlyArray<Record<string, unknown>> };

export type SseHandlers = {
  onStarted?: (event: Extract<PipelineSseEvent, { type: "pipeline.started" }>) => void;
  onStepStarted?: (event: Extract<PipelineSseEvent, { type: "step.started" }>) => void;
  onStepCompleted?: (event: Extract<PipelineSseEvent, { type: "step.completed" }>) => void;
  onCompleted?: (event: Extract<PipelineSseEvent, { type: "pipeline.completed" }>) => void;
  onError?: (err: unknown) => void;
};

export type SseSubscription = { close: () => void };

function buildEventsUrl(runId: string | null): string {
  if (runId === null) {
    return `${sidecarBaseUrl}/events`;
  }
  return `${sidecarBaseUrl}/events?runId=${encodeURIComponent(runId)}`;
}

function dispatch(event: PipelineSseEvent, handlers: SseHandlers): void {
  switch (event.type) {
    case "pipeline.started":
      handlers.onStarted?.(event);
      return;
    case "step.started":
      handlers.onStepStarted?.(event);
      return;
    case "step.completed":
      handlers.onStepCompleted?.(event);
      return;
    case "pipeline.completed":
      handlers.onCompleted?.(event);
      return;
  }
}

function open(url: string, handlers: SseHandlers): SseSubscription {
  let closed = false;
  const source = new EventSource(url);
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  source.onmessage = (msg: MessageEvent) => {
    try {
      const parsed = JSON.parse(msg.data) as PipelineSseEvent;
      dispatch(parsed, handlers);
    } catch (err) {
      handlers.onError?.(err);
    }
  };
  source.onerror = (err) => {
    handlers.onError?.(err);
    close();
  };
  return { close };
}

export function subscribeToRun(runId: string, handlers: SseHandlers): SseSubscription {
  return open(buildEventsUrl(runId), handlers);
}

export function subscribeAll(handlers: SseHandlers): SseSubscription {
  return open(buildEventsUrl(null), handlers);
}
