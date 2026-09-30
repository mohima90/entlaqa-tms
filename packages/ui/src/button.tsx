import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-primary-text hover:bg-surface-hover',
  danger: 'bg-danger text-on-danger hover:bg-danger-hover',
};

/* Heights follow --size-control-*; md/lg meet the 44px touch target. */
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 text-sm',
  md: 'min-h-11 px-4 text-base',
  lg: 'min-h-12 px-6 text-lg',
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
    variants[options.variant ?? 'primary'],
    sizes[options.size ?? 'md'],
    options.className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
}

export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}
