import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary shadow-1 hover:bg-primary-hover',
  /* Kawadir "outline": a white button with a visible boundary (border-strong, SC 1.4.11). */
  secondary: 'bg-surface text-text border border-border-strong shadow-1 hover:bg-surface-hover',
  ghost: 'bg-transparent text-primary-text hover:bg-surface-hover',
  danger: 'bg-danger text-on-danger shadow-1 hover:bg-danger-hover',
  /* A destructive action that only opens its confirmation (e.g. «تعطيل المستخدم», screen 3). */
  'danger-outline': 'bg-surface text-danger border border-danger hover:bg-danger-subtle',
};

/*
 * Kawadir sizes (shadcn new-york): 32 / 36 / 40 px high on a desktop, and at least 44 px on touch
 * screens (pointer: coarse; NFR-UX-02). `icon` is a square icon-only button (give it an aria-label).
 */
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 text-sm pointer-coarse:min-h-11',
  md: 'min-h-9 px-4 py-1.5 text-sm pointer-coarse:min-h-11',
  lg: 'min-h-10 px-8 text-base pointer-coarse:min-h-12',
  icon: 'size-9 shrink-0 rounded-xl text-text-muted hover:text-text pointer-coarse:size-11',
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
    'inline-flex items-center justify-center gap-2 rounded-md font-medium no-underline',
    'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
    options.size === 'icon' && options.variant === undefined
      ? 'bg-transparent hover:bg-surface-hover'
      : variants[options.variant ?? 'primary'],
    sizes[options.size ?? 'md'],
    options.className,
  );
}

/** Icon-only buttons of the top bar (Kawadir: 36 px, rounded-xl, muted icon; 44 px on touch screens). */
export const iconButtonClasses = buttonClasses({ size: 'icon' });

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
}

export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}
