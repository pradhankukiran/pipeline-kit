import type { ServerResponse } from "node:http";
import type { PipelineEvent, PipelineEventSink } from "../contracts.js";

/**
 * Optional predicate evaluated for every published event before it is written
 * to a particular client. Return `true` to deliver the event, `false` to skip
 * it. When a client supplies no filter (the default), every event is sent.
 */
export type EventFilter = (event: PipelineEvent) => boolean;

type EventClient = {
  readonly id: number;
  readonly response: ServerResponse;
  readonly filter?: EventFilter;
};

export interface AddClientOptions {
  readonly filter?: EventFilter;
}

export class ServerEventBroker implements PipelineEventSink {
  private clients = new Map<number, EventClient>();
  private nextClientId = 1;
  private nextEventId = 1;

  addClient(response: ServerResponse, options: AddClientOptions = {}): () => void {
    const id = this.nextClientId;
    this.nextClientId += 1;

    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    });
    response.write(": connected\n\n");

    const client: EventClient = {
      id,
      response,
      ...(options.filter ? { filter: options.filter } : {})
    };
    this.clients.set(id, client);

    return () => {
      this.clients.delete(id);
      response.end();
    };
  }

  publish(event: PipelineEvent): void {
    const payload = [
      `id: ${this.nextEventId}`,
      `event: ${event.type}`,
      `data: ${JSON.stringify(event)}`,
      ""
    ].join("\n");
    this.nextEventId += 1;

    for (const client of this.clients.values()) {
      if (client.filter && !client.filter(event)) {
        continue;
      }
      client.response.write(`${payload}\n`);
    }
  }
}

/**
 * Builds a filter that only passes events whose `pipelineId` matches the
 * supplied runId. Every current `PipelineRunEvent` carries `pipelineId`, so
 * unrelated events from other runs are dropped. Returns `undefined` when the
 * supplied id is empty/missing — callers should treat that as "no filter".
 */
export function createRunIdFilter(runId: string | null | undefined): EventFilter | undefined {
  if (typeof runId !== "string" || runId.length === 0) {
    return undefined;
  }
  return (event: PipelineEvent): boolean => {
    const pipelineId = (event as { pipelineId?: unknown }).pipelineId;
    return typeof pipelineId === "string" ? pipelineId === runId : true;
  };
}
