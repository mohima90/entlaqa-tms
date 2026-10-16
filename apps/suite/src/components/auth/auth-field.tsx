import { cn } from '@jadarat/ui';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { AuthIcon, type AuthIconName } from './auth-icons';

/**
 * A field of the sign-in pages (Kawadir ATS's auth inputs): a small upper-case label (with an optional
 * link at its end, e.g. «نسيت؟» / "Forgot?"), a 48 px rounded input with a leading icon and an optional
 * control at its end (show / hide password), hint and error tied to the input (WCAG 2.2: visible label,
 * programmatic description, 44 px targets). Direction follows the page; pass `dir="ltr"` for e-mails,
 * passwords and codes.
 */
export interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly id: string;
  /** The input element (React 19: `ref` is a prop). */
  readonly ref?: Ref<HTMLInputElement>;
  readonly label: ReactNode;
  /** Shown after the label: «(مطلوب)» / "(required)" (design principles §4). */
  readonly marker?: ReactNode;
  readonly icon?: AuthIconName;
  /** At the end of the label row (a link). */
  readonly labelEnd?: ReactNode;
  /** Inside the input, at its end (a 44 px button). */
  readonly inputEnd?: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  /** Extra classes of the input itself (e.g. a monospace code). */
  readonly inputClassName?: string;
}

export function AuthField({
  id,
  label,
  marker,
  icon,
  labelEnd,
  inputEnd,
  hint,
  error,
  className,
  inputClassName,
  ref,
  'aria-describedby': callerDescribedBy,
  ...props
}: AuthFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [callerDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={id}
          className="text-[13px] font-semibold uppercase tracking-wider text-text"
        >
          {label}
          {marker ? (
            <span className="ms-1 font-normal normal-case tracking-normal text-text-muted">
              {marker}
            </span>
          ) : null}
        </label>
        {labelEnd}
      </div>
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-subtle">
            <AuthIcon name={icon} className="size-[18px]" />
          </span>
        ) : null}
        <input
          {...props}
          ref={ref}
          id={id}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={describedBy}
          className={cn(
            'h-12 w-full rounded-xl border bg-surface text-[15px] text-text transition-colors',
            'placeholder:text-text-subtle hover:border-border-strong focus:border-primary',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-disabled',
            'read-only:bg-surface-sunken',
            icon ? 'ps-11' : 'ps-4',
            inputEnd ? 'pe-12' : 'pe-4',
            error ? 'border-danger' : 'border-border-strong',
            inputClassName,
          )}
        />
        {inputEnd ? (
          <span className="absolute end-0.5 top-1/2 -translate-y-1/2">{inputEnd}</span>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="m-0 text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="m-0 flex items-center gap-1 text-[13px] font-medium text-danger">
          <AuthIcon name="alert" className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The show / hide password control inside an AuthField (a real button with a changing name). */
export function RevealButton({
  shown,
  onToggle,
  showLabel,
  hideLabel,
  controls,
  disabled,
}: {
  readonly shown: boolean;
  readonly onToggle: () => void;
  readonly showLabel: string;
  readonly hideLabel: string;
  /** The input's id. */
  readonly controls: string;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-controls={controls}
      aria-pressed={shown}
      // A toggle keeps its name; its state is aria-pressed (the tooltip says what a click does).
      aria-label={showLabel}
      title={shown ? hideLabel : showLabel}
      disabled={disabled}
      className="inline-flex size-11 items-center justify-center rounded-lg text-text-subtle hover:text-text"
    >
      <AuthIcon name={shown ? 'eyeOff' : 'eye'} className="size-[18px]" />
    </button>
  );
}

/** The primary button of the sign-in pages (48 px, full width, the brand gradient's colour). */
export const authPrimaryButton =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-on-primary no-underline shadow-2 transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60';

/** A secondary (outline) button of the sign-in pages. */
export const authSecondaryButton =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface px-4 text-[15px] font-semibold text-text no-underline transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60';
