import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<ButtonVariant, string> = {
  /*
   * Direction C «Bold product»: a pill on the brand gradient (135°; the organization's colours replace
   * it) with its text colour (checked on both ends) and a soft coloured glow; a little brighter on hover.
   * The colours never change on hover beyond the brightness, so the text keeps its contrast.
   */
  primary:
    'border-transparent bg-brand-gradient font-semibold text-on-brand shadow-brand-glow hover:brightness-[1.07] disabled:shadow-none disabled:hover:brightness-100 aria-disabled:shadow-none',
  /* Outline: the surface with a visible boundary (border-strong, SC 1.4.11). */
  secondary: 'border-border-strong bg-surface text-text hover:bg-surface-hover',
  ghost: 'border-transparent bg-transparent text-primary-text hover:bg-primary-subtle',
  danger: 'border-transparent bg-danger text-on-danger hover:bg-danger-hover',
  /* A destructive action that only opens its confirmation (e.g. «تعطيل المستخدم», screen 3). */
  'danger-outline': 'border-danger bg-surface text-danger hover:bg-danger-subtle',
};

/*
 * Direction C sizes: pills, 36 / 44 / 54 px high (`sm` at least 44 px on touch screens; NFR-UX-02).
 * `icon` is a round icon-only button (give it an aria-label).
 */
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3.5 text-sm font-medium pointer-coarse:min-h-11',
  md: 'min-h-11 px-5 text-[15px]',
  lg: 'min-h-13.5 px-6.5 text-base',
  icon: 'size-10 shrink-0 border-transparent text-text-muted hover:text-text pointer-coarse:size-11',
};

/** Class names for button-styled elements (also used for links styled as buttons). */
export function buttonClasses(
  options: {
    variant?: ButtonVariant | undefined;
    size?: ButtonSize | undefined;
    className?: string | undefined;
  } = {},
) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] font-semibold no-underline',
    'transition-[background-color,box-shadow,filter,transform,border-color,color] duration-[var(--duration-base)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
    'disabled:cursor-not-allowed disabled:opacity-70 aria-disabled:cursor-not-allowed aria-disabled:opacity-70',
    options.size === 'icon' && options.variant === undefined
      ? 'bg-transparent hover:bg-surface-hover'
      : variants[options.variant ?? 'primary'],
    sizes[options.size ?? 'md'],
    options.className,
  );
}

/** Icon-only buttons (36 → 40 px round, muted icon; 44 px on touch screens). */
export const iconButtonClasses = buttonClasses({ size: 'icon' });

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  /**
   * Busy (an action is running): the button keeps its place and size, shows a spinner and is marked
   * `aria-busy`; clicks are ignored by the caller's own pending state.
   */
  readonly busy?: boolean | undefined;
}

export function Button({
  variant,
  size,
  className,
  type = 'button',
  busy = false,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={busy || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** A small spinner in the text colour (turns only without reduced motion; decorative). */
export function Spinner({ className }: { readonly className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-[18px] shrink-0 rounded-full border-[2.5px] border-current border-e-transparent motion-safe:animate-spin',
        className,
      )}
    />
  );
}
