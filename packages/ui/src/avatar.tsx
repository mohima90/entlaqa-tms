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
  /**
   * `brand` (default): initials on the brand gradient (Kawadir account chip). `soft`: initials in the
   * brand text colour on its tint (Kawadir list rows, e.g. «NI» in Candidates).
   */
  readonly tone?: 'brand' | 'soft' | undefined;
  /** The person's photo (T-M2-15b); the initials show until it exists. Decorative like the initials. */
  readonly src?: string | undefined;
  readonly className?: string | undefined;
}

/** A person's picture: their photo, or their initials (Kawadir). Decorative: the name is written next to it. */
export function Avatar({ name, size = 'sm', tone = 'brand', src, className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold',
        tone === 'brand'
          ? 'bg-brand-gradient text-on-nav-item-current ring-2 ring-border'
          : 'bg-primary-subtle text-primary-text',
        size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm',
        className,
      )}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initialsOf(name)}
    </span>
  );
}
