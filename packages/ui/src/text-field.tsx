import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Required: ties the label, hint and error to the input (no generated ids, works in server components). */
  readonly id: string;
  readonly label: ReactNode;
  /** Help text under the field. */
  readonly hint?: ReactNode;
  /** Error message; marks the field invalid and is announced with it. */
  readonly error?: ReactNode;
}

/**
 * Labelled text input (WCAG 2.2: visible label, programmatic hint/error, 44px target). Direction follows
 * the document; pass `dir="ltr"` for e-mail, URLs and codes that keep Latin order in Arabic.
 */
export function TextField({ id, label, hint, error, className, ...props }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="m-0 text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'min-h-11 w-full rounded-md border bg-surface px-3 text-text',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-disabled',
          error ? 'border-danger' : 'border-border-strong',
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} className="m-0 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
