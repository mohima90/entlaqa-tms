'use client';
import { useState } from 'react';
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
  /** `xl`: the large tile at the top of a person's profile (redesign package 3). */
  readonly size?: 'sm' | 'md' | 'xl' | undefined;
  /**
   * `brand` (default): initials on the brand gradient (Kawadir account chip). `soft`: initials in the
   * brand text colour on its tint (Kawadir list rows, e.g. «NI» in Candidates).
   */
  readonly tone?: 'brand' | 'soft' | undefined;
  /** The person's photo (T-M2-15b); the initials show until it exists, and when it cannot be loaded. */
  readonly src?: string | undefined;
  /**
   * The picture's alternative text — the person's name — where no name is written next to it (the profile
   * header, My profile; WP-ADM-04). Omitted (the default): decorative, the name is next to it in lists and
   * in the top bar, so a screen reader does not read it twice.
   */
  readonly alt?: string | undefined;
  readonly className?: string | undefined;
}

/** A person's picture: their photo, or their initials (Kawadir). */
export function Avatar({ name, size = 'sm', tone = 'brand', src, alt, className }: AvatarProps) {
  // A photo that fails to load (removed, offline) falls back to the initials; a new address tries again.
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const showPhoto = src !== undefined && src !== '' && src !== failed;
  return (
    <span
      {...(alt === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': alt })}
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden font-semibold',
        size === 'xl' ? 'rounded-[22px]' : 'rounded-full',
        tone === 'brand'
          ? 'bg-brand-gradient text-on-brand ring-2 ring-border'
          : 'bg-primary-subtle text-primary-text',
        size === 'sm' ? 'size-8 text-xs' : size === 'md' ? 'size-10 text-sm' : 'size-19 text-2xl',
        className,
      )}
    >
      {showPhoto ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          onError={() => {
            setFailed(src);
          }}
        />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
    </span>
  );
}
