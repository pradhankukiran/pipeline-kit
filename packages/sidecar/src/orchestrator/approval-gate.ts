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
 * Resolves the effective approval-gate timeout (in milliseconds) using the
 * documented precedence:
 *
 *   1. `state.settings.approvalTimeoutSec` (× 1000) when set and positive.
 *      Persisted by the desktop Settings panel; this is the source of truth.
 *   2. `process.env.PIPELINEKIT_APPROVAL_TIMEOUT_MS` when set and positive.
 *      Legacy escape hatch for headless deploys.
 *   3. The 60-second default.
 *
 * The `state` argument is optional so callers (and tests) can compute a value
 * without instantiating a full sidecar state.
 */
export function readApprovalTimeoutMs(state?: SidecarState): number {
  const fromState = state?.settings?.approvalTimeoutSec;
  if (typeof fromState === "number" && Number.isFinite(fromState) && fromState > 0) {
    return Math.floor(fromState * 1000);
  }
  const raw = process.env["PIPELINEKIT_APPROVAL_TIMEOUT_MS"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Builds an `ApprovalGate` bound to the supplied sidecar state. The gate
 * registers a pending approval via `addApproval` and polls `state.approvals`
 * until either the user decides (`approved`/`rejected`) or the timeout
 * elapses, in which case it auto-rejects the approval as a system decision.
 *
 * Timeout precedence inside the closure (highest first):
 *   1. `state.settings.approvalTimeoutSec` — UI-driven override.
 *   2. `input.timeoutMs` — per-call value supplied by the executor.
 *   3. `PIPELINEKIT_APPROVAL_TIMEOUT_MS` env var.
 *   4. 60-second default.
 *
 * This ordering lets the desktop Settings panel beat the legacy env-var path
 * without requiring callers (e.g. `BlenderStepExecutor`) to be aware of the
 * persisted setting.
 */
export function createApprovalGate(state: SidecarState): ApprovalGate {
  return async function gate(input: ApprovalGateInput): Promise<ApprovalGateDecision> {
    const timeoutMs = resolveTimeoutMs(state, input.timeoutMs);
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
 * signal fires. The persisted record now carries `status: "cancelled"`
 * (instead of the legacy `rejected` placeholder) so the audit trail and the
 * Review UI can tell run-cancelled approvals apart from user-rejected ones.
 * The in-flight `ApprovalGateDecision.status` keeps its existing `cancelled`
 * value — callers (e.g. `BlenderStepExecutor`) already discriminate on that
 * to throw a cancellation-specific error rather than the rejected branch.
 */
function cancelDueToAbort(state: SidecarState, approvalId: string): ApprovalGateDecision {
  const reason = "Run cancelled while awaiting approval";
  decideApproval(state, approvalId, "cancelled", {
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

/**
 * Resolves the effective per-call timeout for the gate's wait loop. Prefers
 * the persisted desktop setting (`state.settings.approvalTimeoutSec`), then
 * the explicit per-call `input.timeoutMs`, then falls back to the env-var /
 * default chain in `readApprovalTimeoutMs`.
 */
function resolveTimeoutMs(state: SidecarState, perCall: number | undefined): number {
  const fromState = state.settings?.approvalTimeoutSec;
  if (typeof fromState === "number" && Number.isFinite(fromState) && fromState > 0) {
    return Math.floor(fromState * 1000);
  }
  if (typeof perCall === "number" && Number.isFinite(perCall) && perCall > 0) {
    return perCall;
  }
  return readApprovalTimeoutMs(state);
}
