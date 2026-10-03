import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-border-strong bg-surface-sunken',
  info: 'border-info bg-info-subtle',
  success: 'border-success bg-success-subtle',
  warning: 'border-warning bg-warning-subtle',
  danger: 'border-danger bg-danger-subtle',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone | undefined;
}

/** Short status label (e.g. a session's state). The text carries the meaning; the tone only supports it. */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium text-text',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
