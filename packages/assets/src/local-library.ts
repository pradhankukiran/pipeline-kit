import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { localLibrarySource } from "./sources.js";
import type {
  LocalLibraryAssetSource,
  LocalLibraryScanOptions,
  LocalLibraryScanPlan,
  PipelineKitAssetKind
} from "./types.js";

const SCAN_MAX_DEPTH = 6;
const SCAN_MAX_ENTRIES = 5000;

export interface LocalLibraryEntry {
  path: string;
  root: string;
  relativePath: string;
  size: number;
  modifiedAt: number;
}

export interface LocalLibraryScanError {
  path: string;
  message: string;
}

export interface LocalLibraryScanResult {
  roots: string[];
  entries: LocalLibraryEntry[];
  errors?: LocalLibraryScanError[];
}

const defaultIncludeGlobs = [
  "**/*.blend",
  "**/*.fbx",
  "**/*.glb",
  "**/*.gltf",
  "**/*.hdr",
  "**/*.exr",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.json"
] as const;

const defaultExcludeGlobs = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.DS_Store"
] as const;

export function createLocalLibraryScanPlan(options: LocalLibraryScanOptions): LocalLibraryScanPlan {
  const roots = normalizeList(options.roots);
  const warnings: string[] = [];

  if (!options.enabled) {
    return {
      enabled: false,
      roots: [],
      kinds: [],
      includeGlobs: [],
      excludeGlobs: [],
      maxDepth: 0,
      followSymlinks: false,
      warnings: [
        `${localLibrarySource.label} is disabled; no local filesystem scan should be scheduled.`
      ]
    };
  }

  if (roots.length === 0) {
    warnings.push(
      `No local roots were provided; set ${localLibrarySource.defaultRootEnvVar} or pass explicit roots before scanning.`
    );
  }

  return {
    enabled: true,
    roots,
    kinds: normalizeKinds(options.kinds),
    includeGlobs: normalizeList(options.includeGlobs, defaultIncludeGlobs),
    excludeGlobs: normalizeList(options.excludeGlobs, defaultExcludeGlobs),
    maxDepth: normalizeMaxDepth(options.maxDepth),
    followSymlinks: options.followSymlinks ?? false,
    warnings
  };
}

export function canScanLocalLibrary(plan: LocalLibraryScanPlan): boolean {
  return plan.enabled && plan.roots.length > 0;
}

function normalizeKinds(kinds?: readonly PipelineKitAssetKind[]): readonly PipelineKitAssetKind[] {
  return normalizeList(kinds, localLibrarySource.supportedKinds);
}

function normalizeMaxDepth(maxDepth?: number): number {
  if (maxDepth === undefined) {
    return 8;
  }

  return Math.max(0, Math.floor(maxDepth));
}

function normalizeList<T>(values?: readonly T[], fallback: readonly T[] = []): readonly T[] {
  const source = values?.length ? values : fallback;

  return Array.from(new Set(source));
}

export async function scanLocalLibrary(
  source: LocalLibraryAssetSource
): Promise<LocalLibraryScanResult> {
  const envRoot = process.env[source.defaultRootEnvVar];
  const enabled = source.enabledByDefault === true || Boolean(envRoot);

  if (!enabled) {
    return { roots: [], entries: [] };
  }

  const roots = envRoot ? [envRoot] : [];
  const plan = createLocalLibraryScanPlan({
    enabled: true,
    roots,
    maxDepth: SCAN_MAX_DEPTH
  });

  const entries: LocalLibraryEntry[] = [];
  const errors: LocalLibraryScanError[] = [];
  const includeMatchers = plan.includeGlobs.map(globToRegex);
  const excludeMatchers = plan.excludeGlobs.map(globToRegex);
  const maxDepth = Math.min(plan.maxDepth, SCAN_MAX_DEPTH);

  for (const root of plan.roots) {
    const absRoot = resolve(root);
    await walk(absRoot, absRoot, 0);
  }

  return errors.length > 0
    ? { roots: [...plan.roots], entries, errors }
    : { roots: [...plan.roots], entries };

  async function walk(currentPath: string, root: string, depth: number): Promise<void> {
    if (entries.length >= SCAN_MAX_ENTRIES || depth > maxDepth) {
      return;
    }

    let dirEntries;
    try {
      dirEntries = await readdir(currentPath, { withFileTypes: true });
    } catch (err) {
      errors.push({ path: currentPath, message: errorMessage(err) });
      return;
    }

    for (const dirent of dirEntries) {
      if (entries.length >= SCAN_MAX_ENTRIES) {
        return;
      }

      const fullPath = join(currentPath, dirent.name);
      const relativePath = relative(root, fullPath);
      const normalizedRelative = relativePath.split(sep).join("/");

      if (excludeMatchers.some((re) => re.test(normalizedRelative))) {
        continue;
      }

      if (dirent.isDirectory()) {
        await walk(fullPath, root, depth + 1);
        continue;
      }

      if (!dirent.isFile()) {
        continue;
      }

      if (includeMatchers.length > 0 && !includeMatchers.some((re) => re.test(normalizedRelative))) {
        continue;
      }

      try {
        const stats = await stat(fullPath);
        entries.push({
          path: fullPath,
          root,
          relativePath: normalizedRelative,
          size: stats.size,
          modifiedAt: stats.mtimeMs
        });
      } catch (err) {
        errors.push({ path: fullPath, message: errorMessage(err) });
      }
    }
  }
}

function globToRegex(glob: string): RegExp {
  let regex = "";
  let index = 0;

  while (index < glob.length) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      regex += ".*";
      index += 2;
      if (glob[index] === "/") {
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      index += 1;
      continue;
    }

    if (/[.+^${}()|[\]\\]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
    index += 1;
  }

  return new RegExp(`^${regex}$`);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
