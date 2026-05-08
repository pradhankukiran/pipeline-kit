import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
