import type { ProgressHTMLAttributes } from 'react';
import { cn } from './cn';

export interface ProgressBarProps extends Omit<
  ProgressHTMLAttributes<HTMLProgressElement>,
  'value' | 'max'
> {
  readonly value: number;
  readonly max: number;
  /** What the bar measures, in words (e.g. "4 of 9 submitted") — its accessible name. */
  readonly label: string;
  /**
   * `brand` on a light surface (the brand colour on a grey track); `on-brand` on a brand-gradient fill
   * (the hero card of the open cycle: the text colour of the gradient on a translucent track).
   */
  readonly tone?: 'brand' | 'on-brand' | undefined;
}

const TONES = {
  brand:
    'bg-surface-hover [&::-webkit-progress-bar]:bg-surface-hover [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary',
  'on-brand':
    'bg-on-brand/25 [&::-webkit-progress-bar]:bg-on-brand/25 [&::-webkit-progress-value]:bg-on-brand [&::-moz-progress-bar]:bg-on-brand',
} as const;

/**
 * A progress bar (direction C, redesign package 4 — Workable review cycles): how far something is, e.g.
 * the needs forms submitted of an open cycle. The native `<progress>` (a progressbar with its value, no
 * inline style — the CSP allows none), named in words; the bar supports the number shown next to it and is
 * never the only place it is said.
 */
export function ProgressBar({
  value,
  max,
  label,
  tone = 'brand',
  className,
  ...props
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  return (
    <progress
      aria-label={label}
      value={Math.min(Math.max(value, 0), safeMax)}
      max={safeMax}
      className={cn(
        'block h-2.5 w-full appearance-none overflow-hidden rounded-full border-0 [&::-moz-progress-bar]:rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
