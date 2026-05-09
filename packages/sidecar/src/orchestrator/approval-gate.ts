import type { Approval, ID } from "@pipelinekit/core";
import { addApproval, decideApproval, type SidecarState } from "../server/state.js";

/**
 * Decision returned by the approval gate after a user, the timeout fallback,
 * OR a run-level cancellation has resolved a pending step approval. The
 * `cancelled` status is distinct from `rejected`: the user did not reject the
 * step — the surrounding run was cancelled while we were waiting. Callers
 * map `cancelled` to a thrown abort-style error so the orchestrator can
 * cascade-cancel the remaining steps.
 */
export interface ApprovalGateDecision {
  readonly status: "approved" | "rejected" | "cancelled";
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
  /**
   * Optional `AbortSignal` propagated from the surrounding pipeline run. When
   * the signal aborts while the gate is still waiting for a decision, the
   * gate marks its approval as `rejected` (with `reason: "Run cancelled
   * while awaiting approval"` and `decidedBy: "system"`) and resolves to a
   * `{ status: "cancelled" }` decision. Already-decided approvals are not
   * affected. Without this signal the gate continues to poll until the user
   * decides or `timeoutMs` elapses.
   */
  readonly signal?: AbortSignal;
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

    // Fast-path the abort signal: if the run was already cancelled before we
    // even got here, don't even register a poll cycle.
    if (input.signal?.aborted) {
      return cancelDueToAbort(state, approval.id);
    }

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

      // Check for run cancellation before sleeping. Re-check after the sleep
      // wakes so a signal fired mid-sleep is honored on the next iteration.
      if (input.signal?.aborted) {
        return cancelDueToAbort(state, approval.id);
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

/**
 * Mark an in-flight approval as cancelled-at-gate after the run-level abort
 * signal fires. We persist the cancellation as a `rejected` approval (the
 * existing storage shape only knows approved / rejected) with a distinctive
 * reason so the audit trail is clear, and we surface a `cancelled` decision
 * to the executor so the step error path stays separate from user rejection.
 */
function cancelDueToAbort(state: SidecarState, approvalId: string): ApprovalGateDecision {
  const reason = "Run cancelled while awaiting approval";
  decideApproval(state, approvalId, "rejected", {
    reason,
    decidedBy: "system"
  });
  return {
    status: "cancelled",
    reason,
    approvalId
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
