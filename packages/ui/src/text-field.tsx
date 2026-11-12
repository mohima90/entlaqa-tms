import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Required: ties the label, hint and error to the input (no generated ids, works in server components). */
  readonly id: string;
  readonly label: ReactNode;
  /** Help text under the field. */
  readonly hint?: ReactNode;
  /** Error message; marks the field invalid and is announced with it. */
  readonly error?: ReactNode;
  /**
   * Text after the label: «(مطلوب)» / "(required)", or «(اختياري)» / "(optional)". Pass the translated
   * text. A required field (`required` or `aria-required`) shows a red asterisk instead (PO, 12 Nov 2026;
   * forms standard rule 8) and keeps this text for screen readers; an optional field shows the text.
   */
  readonly marker?: ReactNode;
}

/** Is the control required — natively (`required`) or said to assistive technology (`aria-required`)? */
export function isRequiredField(props: {
  readonly required?: boolean | undefined;
  readonly 'aria-required'?: boolean | 'true' | 'false' | undefined;
}): boolean {
  return (
    props.required === true || props['aria-required'] === true || props['aria-required'] === 'true'
  );
}

/**
 * What follows a field's label (PO, 12 Nov 2026; forms standard rule 8): a red asterisk for a required
 * field — never the word «(required)» on screen — or the marker's text otherwise («(optional)»). The
 * asterisk is hidden from assistive technology; the control itself says it is required, and the marker's
 * words stay in the label for screen readers (so the accessible name still reads «… (required)»). The red
 * is the danger text colour, which passes 4.5 : 1 on every surface and theme (token tests).
 */
export function FieldMarker({
  marker,
  required,
  className,
}: {
  readonly marker?: ReactNode;
  readonly required: boolean;
  /** Spacing of the optional text (the label's own layout decides: inline text or a flex gap). */
  readonly className?: string | undefined;
}) {
  if (required) {
    return (
      <>
        <span aria-hidden="true" className="ms-0.5 font-semibold text-danger" data-required-mark="">
          *
        </span>
        {marker ? <span className="sr-only"> {marker}</span> : null}
      </>
    );
  }
  return marker ? (
    <span className={cn('font-normal text-text-subtle', className ?? 'ms-1')}>{marker}</span>
  ) : null;
}

/**
 * The input of a form field in direction C: 48 px, 14 px corners, a 1.5 px `border-strong` boundary
 * (SC 1.4.11), red when invalid. Shared by every form so they look the same.
 */
export const fieldInputClasses =
  'min-h-12 w-full rounded-md border-[1.5px] border-border-strong bg-surface px-3.5 text-[15px] text-text transition-[border-color,box-shadow] duration-[var(--duration-base)] placeholder:text-text-subtle focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-muted read-only:border-dashed read-only:bg-surface-sunken read-only:text-text-muted';

/** The error line under a field: the alert icon and the message, in the danger colour. */
export function FieldError({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReactNode;
}) {
  return (
    <p id={id} className="m-0 flex items-start gap-2 text-[13.5px] font-semibold text-danger">
      <Icon name="error" className="mt-px size-4" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Labelled text input (WCAG 2.2: visible label, programmatic hint/error; 48 px target). Direction C form
 * pattern: the label above (a red asterisk when required), the input, then the hint and the error under it
 * — the error sits on the field (`aria-invalid`, described by it). Direction follows the document; pass
 * `dir="ltr"` for e-mail, URLs and codes that keep Latin order in Arabic.
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
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        <FieldMarker marker={marker} required={isRequiredField(props)} />
      </label>
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        className={cn(fieldInputClasses, Boolean(error) && 'border-danger')}
      />
      {hint ? (
        <p id={hintId} className="m-0 text-[13.5px] text-text-muted">
          {hint}
        </p>
      ) : null}
      {error && errorId ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
