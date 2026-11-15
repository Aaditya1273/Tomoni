import { cn } from '../cn';

/** The name set at Anek's widest stretch: the width axis is the brand (DESIGN.md). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-bold tracking-[-0.01em] text-neel', className)} style={{ fontStretch: '125%' }}>
      Tomoni
    </span>
  );
}
