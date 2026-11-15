import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[4px] border border-line-strong bg-sunken px-[0.4em] py-[0.05em] font-sans text-xs font-semibold text-muted">
      {children}
    </kbd>
  );
}
