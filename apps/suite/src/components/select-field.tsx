import type { ReactNode, SelectHTMLAttributes } from 'react';

/** Labelled native select with hint and error (same contract as TextField). */
export function SelectField({
  id,
  label,
  marker,
  hint,
  error,
  children,
  ...props
}: {
  id: string;
  label: string;
  marker?: string | undefined;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {marker ? <span className="ms-1 font-normal text-text-muted">{marker}</span> : null}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="m-0 text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      <select
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`select-chevron min-h-9 w-full rounded-full border bg-surface ps-4 pe-10 text-sm text-text shadow-1 pointer-coarse:min-h-11 ${
          error ? 'border-danger' : 'border-border-strong'
        }`}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="m-0 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
