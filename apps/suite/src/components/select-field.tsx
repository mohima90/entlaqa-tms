import { FieldError, cn } from '@jadarat/ui';
import type { ReactNode, SelectHTMLAttributes } from 'react';

/**
 * The select's look: TextField's field (fieldInputClasses) without its read-only style — a <select> always
 * matches :read-only, which would draw every select dashed.
 */
const selectClasses =
  'select-chevron min-h-12 w-full rounded-md border-[1.5px] border-border-strong bg-surface ps-3.5 pe-10 text-[15px] text-text transition-[border-color,box-shadow] duration-[var(--duration-base)] focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-muted';

/**
 * Labelled native select with hint and error — the same contract and look as TextField (direction C,
 * redesign packages 1–2): the label above (with «(required)» in words and an optional tag such as
 * «مقترح» / "Suggested"), the 48 px field, then the hint and the error under it.
 */
export function SelectField({
  id,
  label,
  marker,
  tag,
  hint,
  error,
  children,
  className,
  ...props
}: {
  id: string;
  label: string;
  marker?: string | undefined;
  /** A small pill after the label (e.g. a value filled in from the country). */
  tag?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm font-semibold"
      >
        {label}
        {marker ? <span className="font-normal text-text-subtle">{marker}</span> : null}
        {tag}
      </label>
      <select
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(selectClasses, Boolean(error) && 'border-danger')}
      >
        {children}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className="m-0 text-[13.5px] text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}
