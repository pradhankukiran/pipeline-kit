import { FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type BriefItem = {
  label: string;
  value: string;
};

export type BriefPanelProps = {
  items: BriefItem[];
  className?: string;
};

export function BriefPanel({ items, className }: BriefPanelProps) {
  return (
    <Card className={cn("flex flex-col", className)} id="brief">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-tight">Creative brief</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Active project brief
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">No brief yet</p>
            <p className="mt-1 max-w-[28ch] text-sm text-muted-foreground">
              Create a brief to capture the goal, audience, deliverables, and tone.
            </p>
          </div>
        ) : (
          <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm sm:grid-cols-[8rem_1fr]">
            {items.map((item) => (
              <div key={item.label} className="contents">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </dt>
                <dd className="text-sm text-foreground">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
