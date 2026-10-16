import { cn } from './cn';

/** The first letter of the name (Arabic or Latin), or of each of its first two words in Latin script. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? '')[0] ?? '?';
  // Arabic names: one letter reads better than two joined letters.
  if (/[؀-ۿ]/.test(first)) return first;
  const second = words.length > 1 ? (Array.from(words[1] ?? '')[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export interface AvatarProps {
  readonly name: string;
  readonly size?: 'sm' | 'md' | undefined;
  readonly className?: string | undefined;
}

/**
 * A person's picture: their initials on the brand gradient (Kawadir), until photos arrive (T-M2-15b).
 * Decorative: the name is written next to it.
 */
export function Avatar({ name, size = 'sm', className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-brand-gradient grid shrink-0 place-items-center rounded-full font-semibold text-on-nav-item-current ring-2 ring-border',
        size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
