import type { ReactNode } from 'react';
import { cn } from '../cn';

/** An empty screen is an invitation, not a dead end: say what will appear and what to do. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col items-start gap-3 rounded-panel border border-dashed border-line-strong bg-surface p-6',
        className,
      )}
    >
      {icon && <div className="text-jamun [&>svg]:size-8">{icon}</div>}
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="max-w-[60ch] text-muted">{children}</div>}
      {action}
    </section>
  );
}
