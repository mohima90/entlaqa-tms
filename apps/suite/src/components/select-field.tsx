import { FieldError, cn, fieldInputClasses } from '@jadarat/ui';
import type { ReactNode, SelectHTMLAttributes } from 'react';

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
        className={cn(fieldInputClasses, 'select-chevron pe-10', Boolean(error) && 'border-danger')}
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
