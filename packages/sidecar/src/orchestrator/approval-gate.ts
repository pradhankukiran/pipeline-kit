import type { Approval, ID } from "@pipelinekit/core";
import { addApproval, decideApproval, type SidecarState } from "../server/state.js";

/**
 * Decision returned by the approval gate after a user (or the timeout fallback)
 * has resolved a pending step approval.
 */
export interface ApprovalGateDecision {
  readonly status: "approved" | "rejected";
  readonly reason?: string;
  readonly approvalId: string;
}

/**
 * Inputs required to register a pending approval and wait for a decision.
 */
export interface ApprovalGateInput {
  readonly projectId: ID;
  readonly kind: string;
  readonly summary: string;
  readonly payload?: unknown;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

/**
 * Pauses the caller until a matching approval reaches a terminal status.
 */
export type ApprovalGate = (input: ApprovalGateInput) => Promise<ApprovalGateDecision>;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 500;

/**
 * Builds an `ApprovalGate` bound to the supplied sidecar state. The gate
 * registers a pending approval via `addApproval` and polls `state.approvals`
 * until either the user decides (`approved`/`rejected`) or the timeout
 * elapses, in which case it auto-rejects the approval as a system decision.
 */
export function createApprovalGate(state: SidecarState): ApprovalGate {
  return async function gate(input: ApprovalGateInput): Promise<ApprovalGateDecision> {
    const timeoutMs = normalizePositive(input.timeoutMs, DEFAULT_TIMEOUT_MS);
    const pollMs = normalizePositive(input.pollMs, DEFAULT_POLL_MS);

    const approval: Approval = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      kind: input.kind,
      summary: input.summary,
      status: "pending",
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      createdAt: new Date().toISOString()
    };
    addApproval(state, approval);

    const startedAt = Date.now();
    while (true) {
      const current = state.approvals.find((entry) => entry.id === approval.id);
      if (current && current.status !== "pending") {
        return {
          status: current.status,
          ...(typeof current.reason === "string" ? { reason: current.reason } : {}),
          approvalId: approval.id
        };
      }

      if (Date.now() - startedAt >= timeoutMs) {
        const result = decideApproval(state, approval.id, "rejected", {
          reason: "Approval timed out",
          decidedBy: "system"
        });
        const reason =
          result.kind === "ok"
            ? result.approval.reason ?? "Approval timed out"
            : "Approval timed out";
        return {
          status: "rejected",
          reason,
          approvalId: approval.id
        };
      }

      await sleep(pollMs);
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}
