import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

/* Kawadir notes («Recommended dimensions»): rounded-xl, the tone's tint with a soft border of its hue and
   a tone-coloured icon; the text keeps the normal text colour (≥ 4.5 : 1 on every tint). */
const tones: Record<AlertTone, string> = {
  info: 'border-info/30 bg-info-subtle',
  success: 'border-success/30 bg-success-subtle',
  warning: 'border-warning/30 bg-warning-subtle',
  danger: 'border-danger/30 bg-danger-subtle',
};
const icons: Record<AlertTone, { readonly name: IconName; readonly colour: string }> = {
  info: { name: 'info', colour: 'text-info' },
  success: { name: 'success', colour: 'text-success' },
  warning: { name: 'warning', colour: 'text-warning' },
  danger: { name: 'error', colour: 'text-danger' },
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly tone?: AlertTone | undefined;
  readonly title?: ReactNode;
}

/**
 * Inline message. Roles: `danger` → role="alert" (assertive), other tones → role="status" (polite).
 * Announcement: role="alert" is read when the alert appears, so `{error ? <Alert tone="danger">…} : null}`
 * works. A role="status" region is only read reliably when it already exists and its TEXT changes —
 * for a message that appears after an action (e.g. "Saved"), keep one `<Alert>` (or an empty
 * role="status" element) rendered and change its children instead of mounting it.
 * Colour is never the only signal: the text says what happened. Body text keeps the normal text colour
 * on the subtle background (contrast ≥ 4.5:1, tokens/contrast-report.md).
 */
export function Alert({ tone = 'info', title, className, children, ...props }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border px-4 py-3 text-text', tones[tone], className)}
      {...props}
    >
      <Icon name={icons[tone].name} className={cn('mt-0.5 size-[18px]', icons[tone].colour)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="m-0 font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}
