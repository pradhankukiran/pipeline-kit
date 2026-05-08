import { ListChecks } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type BoardItem = {
  title: string;
  owner: string;
  status: string;
  lane: string;
};

export type ProductionBoardPanelProps = {
  items: BoardItem[];
  className?: string;
};

type StatusBadgeStyle = {
  variant: NonNullable<BadgeProps["variant"]>;
  className?: string;
};

function statusBadgeStyle(status: string): StatusBadgeStyle {
  const key = status.toLowerCase().replace(/\s+/g, "_");
  if (
    key === "done" ||
    key === "complete" ||
    key === "completed" ||
    key === "approved" ||
    key === "ok" ||
    key === "succeeded"
  ) {
    return { variant: "success" };
  }
  if (key === "blocked" || key === "failed" || key === "rejected") {
    return { variant: "destructive" };
  }
  if (key === "skipped" || key === "planned") {
    return { variant: "secondary" };
  }
  if (key === "running" || key === "rendering") {
    return { variant: "outline", className: "border-sky-400 text-sky-700" };
  }
  if (key === "review") {
    return { variant: "outline", className: "border-violet-400 text-violet-700" };
  }
  // pending / in_progress / in-review default
  return { variant: "outline", className: "border-amber-400 text-amber-700" };
}

export function ProductionBoardPanel({ items, className }: ProductionBoardPanelProps) {
  return (
    <Card className={cn("flex flex-col", className)} id="production">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-tight">Production board</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Lane-based production tasks
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ListChecks className="mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">No tasks yet</p>
            <p className="mt-1 max-w-[28ch] text-sm text-muted-foreground">
              Production tasks will appear here as you build out the queue.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((task) => {
              const status = statusBadgeStyle(task.status);
              return (
                <div
                  key={task.title}
                  className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/40 transition-colors"
                >
                  <Badge
                    variant="secondary"
                    className="w-[88px] justify-center shrink-0"
                  >
                    {task.lane}
                  </Badge>
                  <span className="text-sm font-medium truncate flex-1">
                    {task.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {task.owner}
                  </span>
                  <Badge
                    variant={status.variant}
                    className={cn("shrink-0", status.className)}
                  >
                    {task.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
