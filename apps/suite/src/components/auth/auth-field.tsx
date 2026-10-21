import { cn } from '@jadarat/ui';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { AuthIcon, type AuthIconName } from './auth-icons';

/**
 * A field of the pages before the suite (direction C, redesign package 1): the label (with «(required)»
 * in words and an optional link at its end, e.g. «نسيت؟» / "Forgot?"), a 54 px pill input with a leading
 * icon and an optional control at its end (show / hide password), then the error ON the field — icon
 * and text in red, the input marked invalid and described by it — and the hint (WCAG 2.2: visible label,
 * programmatic description, 44 px targets). `shape="box"`: a 14 px-corner box (the large code fields of
 * the MFA pages). Direction follows the page; pass `dir="ltr"` for e-mails, passwords and codes.
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
  /** Test id of the error line (e.g. `sign-in-error`). */
  readonly errorTestId?: string | undefined;
  /** Extra classes of the input itself (e.g. a monospace code). */
  readonly inputClassName?: string;
  readonly shape?: 'pill' | 'box' | undefined;
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
  errorTestId,
  className,
  inputClassName,
  shape = 'pill',
  ref,
  'aria-describedby': callerDescribedBy,
  ...props
}: AuthFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [callerDescribedBy, errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-text">
          {label}
          {marker ? <span className="ms-1 font-normal text-text-subtle">{marker}</span> : null}
        </label>
        {labelEnd}
      </div>
      <div className="relative flex items-center">
        {icon ? (
          <span
            className={cn(
              'pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-subtle',
              shape === 'pill' ? 'start-5' : 'start-4',
            )}
          >
            <AuthIcon name={icon} className="size-4" />
          </span>
        ) : null}
        <input
          {...props}
          ref={ref}
          id={id}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={describedBy}
          className={cn(
            'w-full border-[1.5px] bg-surface text-text transition-[border-color,box-shadow] duration-[var(--duration-base)]',
            'placeholder:text-text-subtle focus:border-primary',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-muted',
            'read-only:border-dashed read-only:bg-surface-sunken read-only:text-text-muted',
            // Symmetric padding: an LTR input (e-mail, password, code) in an Arabic page keeps its icon
            // and end control where the page puts them, whichever side its text starts on.
            shape === 'pill'
              ? cn(
                  'min-h-13.5 rounded-full text-base',
                  inputEnd ? 'px-15' : icon ? 'px-12.5' : 'px-5',
                )
              : cn(
                  'min-h-12 rounded-md text-[15px]',
                  inputEnd ? 'px-14' : icon ? 'px-11.5' : 'px-3.5',
                ),
            error ? 'border-danger' : 'border-border-strong',
            inputClassName,
          )}
        />
        {inputEnd ? (
          <span className="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center">
            {inputEnd}
          </span>
        ) : null}
      </div>
      {error ? (
        <p
          id={errorId}
          className="m-0 flex items-start gap-2 text-[13.5px] font-semibold text-danger"
          data-testid={errorTestId}
        >
          <AuthIcon name="alert" className="mt-px size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="m-0 text-[13.5px] text-text-muted">
          {hint}
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
      className="grid size-11 place-items-center rounded-full text-text-subtle hover:bg-surface-hover hover:text-text"
    >
      <AuthIcon name={shown ? 'eyeOff' : 'eye'} className="size-[18px]" />
    </button>
  );
}

/**
 * The main button of the pages before the suite (direction C): a 54 px pill on the brand gradient with a
 * glow, full width. Never disabled because a field is empty: it checks when pressed and the message goes
 * on the field. Disabled only while busy or when the service is not configured.
 */
export const authPrimaryButton =
  'inline-flex min-h-13.5 w-full items-center justify-center gap-2 rounded-full bg-brand-gradient px-6.5 text-base font-semibold text-on-brand no-underline shadow-brand-glow transition-[filter,transform,box-shadow] duration-[var(--duration-base)] hover:brightness-[1.07] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none disabled:hover:brightness-100';

/** A secondary (outline) pill of the pages before the suite. */
export const authSecondaryButton =
  'inline-flex min-h-13.5 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-border-strong bg-surface px-6.5 text-base font-semibold text-text no-underline transition-colors duration-[var(--duration-base)] hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-70';

/** The «Back to sign in»-style link under a form: a centred 44 px pill link with the back arrow. */
export const authBackLink =
  'inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-full px-3 font-semibold text-primary-text no-underline hover:bg-primary-subtle';

/** A spinner inside a busy button (decorative; the button's text says it is busy). */
export function AuthSpinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-[18px] shrink-0 rounded-full border-[2.5px] border-current border-e-transparent motion-safe:animate-spin"
    />
  );
}
