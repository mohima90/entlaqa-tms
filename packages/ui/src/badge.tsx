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

/**
 * Short status label (e.g. a session's state), Kawadir shape: rounded-md, small semibold text. The text
 * carries the meaning; the tone only supports it (text colour on the subtle fill, ≥ 4.5 : 1).
 */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-semibold text-text',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
