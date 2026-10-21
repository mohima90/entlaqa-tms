'use client';

import { cn } from './cn';
import { Icon } from './icons';
import { toast } from './toast-store';

export interface CopyButtonProps {
  /** What is copied (an e-mail, an employee number…). */
  readonly value: string;
  /** The button's name: «نسخ البريد الإلكتروني» / "Copy Email". */
  readonly label: string;
  /** The toast once copied: «نُسخ البريد الإلكتروني.» / "Email copied." */
  readonly copiedText: string;
  /** The toast when the browser refuses the clipboard («Select the text and copy it»). */
  readonly failedText: string;
  readonly className?: string | undefined;
  readonly 'data-testid'?: string | undefined;
}

/**
 * A small copy button beside a value (direction C, redesign package 3 — Deel's copy buttons): copies the
 * value and says so in a toast (the page's polite live region). Its name says what it copies.
 */
export function CopyButton({
  value,
  label,
  copiedText,
  failedText,
  className,
  'data-testid': testId,
}: CopyButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => toast.success(copiedText),
          () => toast.error(failedText, { duration: 6000 }),
        );
      }}
      className={cn(
        'inline-grid size-8 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11',
        className,
      )}
      data-testid={testId}
    >
      <Icon name="copy" className="size-4" />
    </button>
  );
}
