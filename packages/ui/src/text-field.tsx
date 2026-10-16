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
  /**
   * Text after the label: «(مطلوب)» / "(required)", or «(اختياري)» / "(optional)" — design principles §4:
   * required is shown in words, never only by an asterisk. Pass the translated text.
   */
  readonly marker?: ReactNode;
}

/**
 * Labelled text input (WCAG 2.2: visible label, programmatic hint/error; 44 px target on touch screens). Direction follows
 * the document; pass `dir="ltr"` for e-mail, URLs and codes that keep Latin order in Arabic.
 */
export function TextField({
  id,
  label,
  hint,
  error,
  marker,
  className,
  'aria-describedby': callerDescribedBy,
  ...props
}: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  // The caller's own descriptions (e.g. an error summary) are kept, never replaced.
  const describedBy = [callerDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {marker ? <span className="ms-1 font-normal text-text-muted">{marker}</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="m-0 text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        className={cn(
          // Kawadir input (Branding): a pill — 36 px on a desktop (44 px on touch screens), fully rounded,
          // 16 px inline padding, soft shadow; the boundary stays `border-strong` (SC 1.4.11).
          'min-h-9 w-full rounded-full border bg-surface px-4 py-1.5 text-sm text-text shadow-1 transition-[border-color,box-shadow] placeholder:text-text-subtle hover:border-text-muted pointer-coarse:min-h-11',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-disabled',
          error ? 'border-danger' : 'border-border-strong',
        )}
      />
      {error ? (
        <p id={errorId} className="m-0 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
