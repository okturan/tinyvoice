import type { ReactNode } from "react";

interface PageShellProps {
  children: ReactNode;
}

/**
 * Single-column centered container for both pages.
 */
export function PageShell({ children }: PageShellProps) {
  return (
    <div className="min-h-screen bg-[var(--base)] text-[var(--text)]">
      <div className="max-w-[520px] mx-auto flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}
