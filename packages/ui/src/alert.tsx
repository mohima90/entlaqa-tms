import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

/* Direction C banners: the tone's tint with a border of its hue, the icon and the text in the tone's
   colour (every tone/tint pair passes 4.5 : 1, tokens/contrast-report.md), a bold title. */
const tones: Record<AlertTone, string> = {
  info: 'border-info/35 bg-info-subtle text-info',
  success: 'border-success/35 bg-success-subtle text-success',
  warning: 'border-warning/35 bg-warning-subtle text-warning',
  danger: 'border-danger/35 bg-danger-subtle text-danger',
};
const icons: Record<AlertTone, IconName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly tone?: AlertTone | undefined;
  readonly title?: ReactNode;
  /** A next step at the inline end (e.g. a link styled as a button). */
  readonly action?: ReactNode;
}

/**
 * Inline message. Roles: `danger` → role="alert" (assertive), other tones → role="status" (polite).
 * Announcement: role="alert" is read when the alert appears, so `{error ? <Alert tone="danger">…} : null}`
 * works. A role="status" region is only read reliably when it already exists and its TEXT changes —
 * for a message that appears after an action (e.g. "Saved"), keep one `<Alert>` (or an empty
 * role="status" element) rendered and change its children instead of mounting it.
 * Colour is never the only signal: the text says what happened. The text is in the tone's colour on its
 * tint (contrast ≥ 4.5:1, tokens/contrast-report.md).
 */
export function Alert({ tone = 'info', title, action, className, children, ...props }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-md border px-4 py-3.5 text-[14.5px]',
        tones[tone],
        className,
      )}
      {...props}
    >
      <Icon name={icons[tone]} className="mt-0.5 size-[18px]" />
      <div className="min-w-0 flex-1">
        {title ? <p className="m-0 font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-0.5' : undefined}>{children}</div> : null}
      </div>
      {action ? <div className="ms-auto flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
