import * as React from "react";
import { Link } from "react-router-dom";

import { Separator } from "@/components/ui/separator";

export type AppShellProps = {
  projectPicker?: React.ReactNode;
  topbarMetrics?: React.ReactNode;
  topbarActions?: React.ReactNode;
  apiStatus?: React.ReactNode;
  children: React.ReactNode;
  /**
   * When true, AppShell renders children directly inside <main> without
   * the centered max-w wrapper. Useful for layouts that own their own
   * content layout (e.g. sidebar + outlet).
   */
  disableContentContainer?: boolean;
};

export function AppShell({
  projectPicker,
  topbarMetrics,
  topbarActions,
  apiStatus,
  children,
  disableContentContainer = false
}: AppShellProps) {
  const hasProjectPicker = Boolean(projectPicker);
  const hasMetrics = Boolean(topbarMetrics);

  return (
    <div className="flex min-h-screen min-w-[980px] flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 flex h-[60px] shrink-0 items-center gap-4 border-b border-border bg-white px-6">
        <Link
          to="/"
          aria-label="PipelineKit home"
          className="text-2xl font-bold tracking-tighter leading-none text-foreground transition-colors hover:text-foreground/70"
        >
          PipelineKit
        </Link>
        {hasProjectPicker ? (
          <>
            <Separator orientation="vertical" className="h-6" />
            <div className="min-w-0 flex-1">{projectPicker}</div>
          </>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {hasMetrics ? (
          <div className="hidden items-center gap-2 lg:flex">{topbarMetrics}</div>
        ) : null}
        <div className="flex items-center gap-2">
          {apiStatus}
          {topbarActions}
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-secondary/30">
        {disableContentContainer ? (
          children
        ) : (
          <div className="mx-auto w-full max-w-[1400px] px-6 py-6">{children}</div>
        )}
      </main>
    </div>
  );
}
