import { CircleCheck, Clock3, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

export type Status = 'ok' | 'watch' | 'act';

const look: Record<Status, { cls: string; Icon: typeof CircleCheck }> = {
  ok: { cls: 'bg-ok-bg text-ok', Icon: CircleCheck },
  watch: { cls: 'bg-watch-bg text-watch', Icon: Clock3 },
  act: { cls: 'bg-act-bg text-act', Icon: TriangleAlert },
};

/** Access Score status: always icon + words + color, never color alone (DESIGN principle 1). */
export function StatusPill({
  status,
  children,
  className,
}: {
  status: Status;
  children: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = look[status];
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-[0.7em] py-[0.2em] text-sm font-semibold',
        cls,
        className,
      )}
    >
      <Icon aria-hidden className="size-[1.05em] shrink-0" strokeWidth={2.4} />
      {children}
    </span>
  );
}
