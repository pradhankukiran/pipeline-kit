import { AssetsSearchPanel } from "@/components/panels/AssetsSearchPanel";

export function AssetsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Asset library</h1>
        <p className="text-sm text-muted-foreground">
          Search procedural recipes, Poly Haven, and local libraries.
        </p>
      </header>
      <AssetsSearchPanel />
    </div>
  );
}
