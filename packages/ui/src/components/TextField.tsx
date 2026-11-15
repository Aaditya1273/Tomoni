import { CircleAlert } from 'lucide-react';
import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../cn';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, className, ...input }: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
        className={cn(
          'min-h-target rounded-control border bg-surface px-[0.8em] text-ink placeholder:text-muted',
          error ? 'border-act border-2' : 'border-line-strong',
        )}
        {...input}
      />
      {error && (
        <p id={errId} className="flex items-start gap-1.5 text-sm font-medium text-act">
          <CircleAlert aria-hidden className="mt-[0.2em] size-[1em] shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
