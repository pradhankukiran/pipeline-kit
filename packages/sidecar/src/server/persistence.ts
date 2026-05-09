import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Approval, Project } from "@pipelinekit/core";
import type { PipelineRunRecord, RecentOperation, SidecarSettings } from "./state.js";

const CURRENT_SCHEMA_VERSION = 2;
const SUPPORTED_SCHEMA_VERSIONS = new Set<number>([1, 2]);

export interface PersistedState {
  readonly schemaVersion: number;
  readonly settings: SidecarSettings;
  readonly recentOperations: readonly RecentOperation[];
  readonly pipelineRuns?: readonly PipelineRunRecord[];
  readonly projects?: readonly Project[];
  readonly activeProjectId?: string | null;
  readonly approvals?: readonly Approval[];
}

export interface JsonFileStore {
  readonly path: string;
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
}

export function resolveStatePath(): string {
  const override = process.env["PIPELINEKIT_STATE_FILE"];
  if (override && override.trim().length > 0) {
    return override;
  }

  return join(homedir(), ".pipelinekit", "state.json");
}

export function createJsonFileStore(filePath: string = resolveStatePath()): JsonFileStore {
  return {
    path: filePath,
    async load(): Promise<PersistedState | null> {
      try {
        const text = await readFile(filePath, "utf8");
        if (text.trim().length === 0) {
          return null;
        }

        const parsed = JSON.parse(text);
        if (!isPersistedState(parsed)) {
          warn(`Ignoring malformed sidecar state at ${filePath}: schema mismatch.`);
          return null;
        }

        return parsed;
      } catch (error) {
        if (isFileNotFound(error)) {
          return null;
        }

        warn(`Failed to read sidecar state at ${filePath}: ${errorMessage(error)}`);
        return null;
      }
    },
    async save(state: PersistedState): Promise<void> {
      const directory = dirname(filePath);
      await mkdir(directory, { recursive: true });

      const tempPath = `${filePath}.tmp`;
      const payload = JSON.stringify(state, null, 2);
      await writeFile(tempPath, payload, { encoding: "utf8" });
      await rename(tempPath, filePath);
    }
  };
}

export const STATE_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

function isPersistedState(value: unknown): value is PersistedState {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value["schemaVersion"] !== "number" || !SUPPORTED_SCHEMA_VERSIONS.has(value["schemaVersion"] as number)) {
    return false;
  }

  if (!isRecord(value["settings"])) {
    return false;
  }

  if (!Array.isArray(value["recentOperations"])) {
    return false;
  }

  const settings = value["settings"] as Record<string, unknown>;
  if (!isRecord(settings["models"]) || !isRecord(settings["blender"])) {
    return false;
  }

  return true;
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && (error as { code?: string }).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warn(message: string): void {
  process.stderr.write(`[pipelinekit-sidecar] ${message}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns the absolute directory in which evicted history entries are
 * archived. Honours `PIPELINEKIT_ARCHIVE_DIR` when set to a non-empty value,
 * falling back to `~/.pipelinekit/archive`. Mirrors `getRenderDir()` so
 * operators only have one home-dir convention to learn.
 */
export function getArchiveDir(): string {
  const override = process.env["PIPELINEKIT_ARCHIVE_DIR"];
  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }

  return join(homedir(), ".pipelinekit", "archive");
}

/**
 * Appends evicted pipeline-run records to a monthly JSONL archive.
 *
 * - One JSON object per line, partitioned by `<archiveDir>/runs-YYYY-MM.jsonl`
 *   derived from each entry's `startedAt` (falling back to "now" when the
 *   field is missing or unparseable).
 * - Failures are logged to stderr but never re-thrown — the in-memory cap
 *   eviction must succeed even if disk is full or read-only.
 */
export async function archiveEvictedRuns(
  entries: readonly PipelineRunRecord[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const archiveDir = getArchiveDir();
  try {
    await mkdir(archiveDir, { recursive: true });
  } catch (error) {
    warn(`Failed to create archive dir at ${archiveDir}: ${errorMessage(error)}`);
    return;
  }

  // Group by month so we issue one append per file.
  const grouped = new Map<string, PipelineRunRecord[]>();
  for (const entry of entries) {
    const partition = monthPartition(entry.startedAt);
    const bucket = grouped.get(partition) ?? [];
    bucket.push(entry);
    grouped.set(partition, bucket);
  }

  for (const [partition, bucket] of grouped) {
    const filePath = join(archiveDir, `runs-${partition}.jsonl`);
    const payload = bucket.map((entry) => `${JSON.stringify(entry)}\n`).join("");
    try {
      await appendFile(filePath, payload, { encoding: "utf8" });
    } catch (error) {
      warn(`Failed to append archive file ${filePath}: ${errorMessage(error)}`);
    }
  }
}

/**
 * Appends evicted recent-operations entries to a monthly JSONL archive.
 *
 * Operations don't carry a timestamp of their own (the wrapper `result` may,
 * but it's free-form per provider), so we partition by current wall-clock
 * time. Same fire-and-forget semantics as `archiveEvictedRuns`.
 */
export async function archiveEvictedOperations(
  entries: readonly RecentOperation[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const archiveDir = getArchiveDir();
  try {
    await mkdir(archiveDir, { recursive: true });
  } catch (error) {
    warn(`Failed to create archive dir at ${archiveDir}: ${errorMessage(error)}`);
    return;
  }

  const partition = monthPartition(new Date().toISOString());
  const filePath = join(archiveDir, `operations-${partition}.jsonl`);
  const payload = entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
  try {
    await appendFile(filePath, payload, { encoding: "utf8" });
  } catch (error) {
    warn(`Failed to append archive file ${filePath}: ${errorMessage(error)}`);
  }
}

function monthPartition(isoLike: string | undefined): string {
  const candidate = typeof isoLike === "string" ? new Date(isoLike) : new Date();
  const date = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}
