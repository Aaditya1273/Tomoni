import { Slot } from 'radix-ui';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-neel text-neel-ink hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken',
  quiet: 'bg-transparent text-neel hover:bg-neel-soft',
  danger: 'bg-act text-surface hover:brightness-110',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Full width on small screens (family app primary actions). */
  block?: boolean;
  loading?: boolean;
  asChild?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  block,
  loading,
  asChild,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(
        'inline-flex min-h-target items-center justify-center gap-2 rounded-control px-[1.1em] font-semibold',
        'transition-[filter,background-color] duration-150 disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        block && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <LoaderCircle aria-hidden className="size-[1.1em] animate-spin" /> : icon}
          {children}
        </>
      )}
    </Comp>
  );
}
