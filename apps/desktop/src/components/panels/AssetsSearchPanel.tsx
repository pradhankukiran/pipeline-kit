import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Info, Loader2, Search, SearchX } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  importAsset,
  searchAssets,
  type AssetCandidate,
  type AssetImportKind
} from "@/sidecarApi";

export type AssetKindFilter =
  | "any"
  | "hdri"
  | "material"
  | "texture"
  | "model"
  | "rig"
  | "recipe";

export type AssetSourceFilter =
  | "any"
  | "procedural"
  | "poly-haven"
  | "local-library";

export interface AssetsSearchPanelProps {
  className?: string;
}

const KIND_OPTIONS: { value: AssetKindFilter; label: string }[] = [
  { value: "any", label: "Any kind" },
  { value: "hdri", label: "HDRI" },
  { value: "material", label: "Material" },
  { value: "texture", label: "Texture" },
  { value: "model", label: "Model" },
  { value: "rig", label: "Rig" },
  { value: "recipe", label: "Recipe" }
];

const SOURCE_OPTIONS: { value: AssetSourceFilter; label: string }[] = [
  { value: "any", label: "Any source" },
  { value: "procedural", label: "Procedural" },
  { value: "poly-haven", label: "Poly Haven" },
  { value: "local-library", label: "Local library" }
];

type ImportStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "success"; message: string }
  | { state: "error"; message: string };

const SUCCESS_BADGE_TIMEOUT_MS = 3_000;

type NormalizedSource = "poly-haven" | "procedural" | "local-library" | "unknown";

function normalizeSource(value: string | undefined): NormalizedSource {
  if (!value) return "unknown";
  const normalized = value.toLowerCase();
  if (
    normalized === "polyhaven" ||
    normalized === "poly-haven" ||
    normalized.includes("poly haven")
  ) {
    return "poly-haven";
  }
  if (normalized.startsWith("procedur")) {
    return "procedural";
  }
  if (
    normalized === "local" ||
    normalized === "local-library" ||
    normalized.includes("local")
  ) {
    return "local-library";
  }
  return "unknown";
}

function inferLocalPath(candidate: AssetCandidate): string | null {
  const meta = candidate.metadata;
  if (!meta) return null;
  const direct = meta["path"];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const localPath = meta["localPath"];
  if (typeof localPath === "string" && localPath.length > 0) return localPath;
  const filePath = meta["filePath"];
  if (typeof filePath === "string" && filePath.length > 0) return filePath;
  return null;
}

function asImportKind(value: string | undefined): AssetImportKind | null {
  if (value === "hdri" || value === "material" || value === "model") {
    return value;
  }
  return null;
}

function ResultRow({ candidate }: { candidate: AssetCandidate }) {
  const tags = candidate.tags ?? [];
  const visibleTags = tags.slice(0, 4);
  const remainingTags = tags.length - visibleTags.length;
  const score = Math.round(candidate.score);
  const [importStatus, setImportStatus] = useState<ImportStatus>({ state: "idle" });

  const source = normalizeSource(candidate.source);
  const importKind = asImportKind(candidate.kind);
  const localPath = inferLocalPath(candidate);
  const isPolyHavenImportable = source === "poly-haven" && Boolean(importKind);
  const isLocalImportable =
    source === "local-library" &&
    Boolean(importKind) &&
    Boolean(localPath);
  const isImportable = isPolyHavenImportable || isLocalImportable;

  async function handleImport() {
    if (!isImportable || importStatus.state === "loading") return;
    setImportStatus({ state: "loading" });

    const response =
      source === "poly-haven" && importKind
        ? await importAsset({
            source: "polyhaven",
            id: candidate.id,
            kind: importKind,
            // Resolution is only meaningful for HDRI/material; keep "2k"
            // as the default for those, omit for models so the sidecar
            // applies its own default.
            resolution: importKind === "model" ? undefined : "2k"
          })
        : source === "local-library" && importKind && localPath
          ? await importAsset({
              source: "local",
              path: localPath,
              kind: importKind
            })
          : null;

    if (!response) {
      setImportStatus({
        state: "error",
        message: "Cannot derive import payload for this candidate"
      });
      return;
    }

    if (response.ok) {
      setImportStatus({
        state: "success",
        message: response.message ?? "Imported"
      });
      window.setTimeout(() => {
        setImportStatus((current) =>
          current.state === "success" ? { state: "idle" } : current
        );
      }, SUCCESS_BADGE_TIMEOUT_MS);
    } else {
      setImportStatus({
        state: "error",
        message: response.error ?? "Import failed"
      });
    }
  }

  return (
    <div className="rounded-md border border-border p-3 hover:bg-accent/30 hover:border-border transition-colors space-y-2">
      <div className="flex items-start gap-3">
        <p className="text-sm font-medium break-words flex-1">
          {candidate.label || candidate.id}
        </p>
        <Badge variant="secondary" className="ml-auto">
          {candidate.source}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <code className="font-mono text-[11px] text-muted-foreground break-all">
          {candidate.id}
        </code>
        {candidate.kind ? (
          <span className="text-xs text-muted-foreground">{candidate.kind}</span>
        ) : null}
        <Badge variant="outline" className="text-[11px]">
          score {score}
        </Badge>
      </div>
      {visibleTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {visibleTags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[11px]">
              {tag}
            </Badge>
          ))}
          {remainingTags > 0 ? (
            <span className="text-xs text-muted-foreground">
              +{remainingTags} more
            </span>
          ) : null}
        </div>
      ) : null}
      {candidate.reason ? (
        <p className="text-sm text-muted-foreground break-words">
          {candidate.reason}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {isImportable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={importStatus.state === "loading"}
            onClick={() => void handleImport()}
          >
            {importStatus.state === "loading" ? (
              <>
                <Loader2 className="animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <Download />
                Import
              </>
            )}
          </Button>
        ) : null}
        {source === "procedural" ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3 w-3" aria-hidden />
            Procedural recipes are emitted via typed ops — no import needed.
          </span>
        ) : null}
        {source === "local-library" && !isLocalImportable ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3 w-3" aria-hidden />
            {!localPath
              ? "Missing local path — re-index the library to enable import."
              : "Unsupported kind for local import."}
          </span>
        ) : null}
        {importStatus.state === "success" ? (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {importStatus.message}
          </Badge>
        ) : null}
        {importStatus.state === "error" ? (
          <Badge variant="destructive" className="gap-1 max-w-[40ch] truncate">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{importStatus.message}</span>
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

export function AssetsSearchPanel({ className }: AssetsSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetKindFilter>("any");
  const [source, setSource] = useState<AssetSourceFilter>("any");
  const [candidates, setCandidates] = useState<AssetCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // The `searchAssets` endpoint doesn't take a source filter today, so we
  // narrow client-side. This keeps things simple while still letting users
  // scope to procedural/Poly Haven/local results.
  const filteredCandidates = useMemo(() => {
    if (source === "any") return candidates;
    return candidates.filter(
      (candidate) => normalizeSource(candidate.source) === source
    );
  }, [candidates, source]);

  async function handleSearch() {
    if (searching) return;
    setSearching(true);
    setSearchError(null);
    const trimmed = query.trim();
    const result = await searchAssets({
      query: trimmed.length > 0 ? trimmed : undefined,
      kind: kind === "any" ? undefined : kind,
      limit: 25
    });
    setSearched(true);
    if (result.ok) {
      setCandidates(result.candidates);
      setSearchError(null);
    } else {
      setCandidates([]);
      setSearchError(result.error ?? "Asset search failed");
    }
    setSearching(false);
  }

  return (
    <Card className={cn(className)} id="assets-search">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-tight">
          Asset search
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Search procedural recipes, Poly Haven, and local libraries
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={query}
              placeholder="Search assets… e.g. softbox, hdri, water bottle"
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSearch();
                }
              }}
            />
          </div>
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as AssetKindFilter)}
          >
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={source}
            onValueChange={(value) => setSource(value as AssetSourceFilter)}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={() => void handleSearch()}
            disabled={searching}
          >
            {searching ? (
              <>
                <Loader2 className="animate-spin" />
                Searching…
              </>
            ) : (
              <>
                <Search />
                Search
              </>
            )}
          </Button>
        </div>

        {searchError ? (
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              aria-hidden
            />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-destructive">
                Asset search failed
              </p>
              <p className="text-xs text-muted-foreground">{searchError}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSearch()}
              disabled={searching}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {searching && filteredCandidates.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : filteredCandidates.length > 0 ? (
          <div className="space-y-2">
            {filteredCandidates.map((candidate) => (
              <ResultRow key={candidate.id} candidate={candidate} />
            ))}
          </div>
        ) : searchError ? null : searched ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <SearchX
              className="mb-3 h-10 w-10 text-muted-foreground/40"
              aria-hidden
            />
            <p className="text-sm font-medium">No matches</p>
            <p className="mt-1 max-w-[28ch] text-sm text-muted-foreground">
              {candidates.length > 0 && source !== "any"
                ? "Try widening the source filter."
                : "Try different terms or remove the kind filter."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search
              className="mb-3 h-10 w-10 text-muted-foreground/40"
              aria-hidden
            />
            <p className="text-sm font-medium">Search the asset library</p>
            <p className="mt-1 max-w-[28ch] text-sm text-muted-foreground">
              Try a query like “softbox” or “hdri studio”.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
