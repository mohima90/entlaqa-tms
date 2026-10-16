import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/* Kawadir chips («New», «Published», «Closed»): the tone's text on its tint, a soft border of the same
   hue (decorative — the text carries the meaning; every text/tint pair passes 4.5 : 1). */
const tones: Record<BadgeTone, string> = {
  neutral: 'border-border bg-surface-sunken text-text-muted',
  info: 'border-info/25 bg-info-subtle text-info',
  success: 'border-success/25 bg-success-subtle text-success',
  warning: 'border-warning/25 bg-warning-subtle text-warning',
  danger: 'border-danger/25 bg-danger-subtle text-danger',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone | undefined;
}

/**
 * Short status label (e.g. a session's state), Kawadir shape: rounded-md, small semibold text in the
 * tone's colour. The text carries the meaning; the tone only supports it (≥ 4.5 : 1 on the tint).
 */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
