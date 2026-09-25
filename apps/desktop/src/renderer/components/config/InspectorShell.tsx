import type { PropsWithChildren } from 'react';

export function InspectorShell({ children }: PropsWithChildren) {
  return (
    <aside className="flex min-h-0 w-[320px] shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[#111214]">
      {children}
    </aside>
  );
}
