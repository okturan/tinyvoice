import type { ReactNode } from "react";

interface AppShellProps {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}

/**
 * Main app grid layout matching original CSS:
 * - 240px sidebar | 1fr main area
 * - 44px header at top, spanning full width
 */
export function AppShell({ header, sidebar, children }: AppShellProps) {
  return (
    <div className="w-[min(96vw,960px)] h-[min(94vh,700px)] m-auto grid grid-cols-[240px_1fr] grid-rows-[44px_1fr] rounded-[14px] overflow-hidden border border-[var(--surface0)] bg-[var(--base)]">
      {header}
      {sidebar}
      {children}
    </div>
  );
}
