import { Camera } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ShotTuple = [
  code: string,
  name: string,
  stage: string,
  length: string,
  state: string
];

export type ShotItem = {
  id: string;
  title: string;
  status: string;
  description?: string;
};

export type ShotBoardPanelProps = {
  shots: ShotItem[];
  className?: string;
};

type StatusBadgeStyle = {
  variant: NonNullable<BadgeProps["variant"]>;
  className?: string;
};

function statusBadgeStyle(status: string): StatusBadgeStyle {
  const key = status.toLowerCase().replace(/\s+/g, "_");
  if (
    key === "final" ||
    key === "locked" ||
    key === "ok" ||
    key === "approved" ||
    key === "completed" ||
    key === "done" ||
    key === "succeeded"
  ) {
    return { variant: "success" };
  }
  if (key === "blocked" || key === "fix_scale" || key === "failed" || key === "rejected") {
    return { variant: "destructive" };
  }
  if (key === "skipped" || key === "planned") {
    return { variant: "secondary" };
  }
  if (key === "rendering" || key === "running") {
    return { variant: "outline", className: "border-sky-400 text-sky-700" };
  }
  if (key === "review" || key === "in-review" || key === "in_review") {
    return { variant: "outline", className: "border-violet-400 text-violet-700" };
  }
  // pending / in_progress default
  return { variant: "outline", className: "border-amber-400 text-amber-700" };
}

export function shotsFromTuples(tuples: ShotTuple[]): ShotItem[] {
  return tuples.map(([code, name, stage, length, state]) => ({
    id: code,
    title: name,
    status: state,
    description: `${stage} / ${length}`
  }));
}

export function ShotBoardPanel({ shots, className }: ShotBoardPanelProps) {
  return (
    <Card className={cn("flex flex-col", className)} id="shotboard">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-tight">Shot board</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Scene-by-scene plan
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {shots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Camera className="mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">No shots planned</p>
            <p className="mt-1 max-w-[28ch] text-sm text-muted-foreground">
              Shots will appear here once you draft the sequence.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {shots.map((shot) => {
              const status = statusBadgeStyle(shot.status);
              return (
                <div
                  key={shot.id}
                  className="rounded-md border border-border p-3 space-y-2 hover:bg-accent/30 hover:border-border transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {shot.id}
                    </span>
                    <Badge
                      variant={status.variant}
                      className={cn("ml-auto shrink-0", status.className)}
                    >
                      {shot.status}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium">{shot.title}</p>
                  {shot.description ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {shot.description}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
