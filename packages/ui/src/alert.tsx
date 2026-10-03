import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const tones: Record<AlertTone, string> = {
  info: 'border-info bg-info-subtle',
  success: 'border-success bg-success-subtle',
  warning: 'border-warning bg-warning-subtle',
  danger: 'border-danger bg-danger-subtle',
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
      className={cn('rounded-md border border-s-4 px-4 py-3 text-text', tones[tone], className)}
      {...props}
    >
      {title ? <p className="m-0 font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
    </div>
  );
}
