import { CircleCheck, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

type Tone = 'info' | 'ok' | 'watch' | 'act';
const look: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'bg-neel-soft text-ink border-neel', Icon: Info },
  ok: { cls: 'bg-ok-bg text-ink border-ok', Icon: CircleCheck },
  watch: { cls: 'bg-watch-bg text-ink border-watch', Icon: TriangleAlert },
  act: { cls: 'bg-act-bg text-ink border-act', Icon: OctagonAlert },
};

export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = look[tone];
  return (
    <div
      role={tone === 'act' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-panel border-l-4 p-4', cls, className)}
    >
      <Icon aria-hidden className="mt-[0.15em] size-[1.2em] shrink-0" />
      <div className="flex flex-col gap-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
