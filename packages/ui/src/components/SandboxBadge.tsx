import { FlaskConical } from 'lucide-react';

/**
 * Shown on every screen whenever any adapter is a mock or real data is off
 * (BUILD_PROMPT rule 0.3). Sticky in the page flow, so it never covers content; never dismissible.
 * Small screens get the short label; the mock list shows from `sm` up.
 */
export function SandboxBadge({ label, short, detail }: { label: string; short: string; detail: string }) {
  return (
    <div
      role="note"
      data-testid="sandbox-badge"
      className="sticky top-0 z-50 flex items-center justify-center gap-1.5 border-b border-watch bg-watch-bg px-3 py-1 text-xs font-semibold text-watch"
    >
      <FlaskConical aria-hidden className="size-[1.1em] shrink-0" />
      <span>{label}</span>
      <span className="font-normal sm:hidden">{short}</span>
      <span className="hidden font-normal sm:inline">{detail}</span>
    </div>
  );
}
