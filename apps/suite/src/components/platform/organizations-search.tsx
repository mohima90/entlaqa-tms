'use client';
import { ListSearch } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';

/** Milliseconds the search waits after the last key before it applies. */
const PAUSE = 400;

/**
 * The search of the Organizations list (redesign package 5): by name or short name, applied when typing
 * pauses or on Enter, and kept in the address (`?q=`, with the chosen view) so a filtered list can be
 * bookmarked. The server filters the rows it already read — no extra query.
 */
export function OrganizationsSearch({
  q,
  base,
  label,
  placeholder,
  resultText,
}: {
  /** The search now (from the address). */
  readonly q: string;
  /** The list's address without `q`, e.g. `/en/platform?view=pending` or `/en/platform`. */
  readonly base: string;
  readonly label: string;
  readonly placeholder: string;
  /** «3 organizations», announced politely when the search changes the list. */
  readonly resultText: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(q);
  const [shownQ, setShownQ] = useState(q);
  // Follows the address (Back, «Clear search») unless the person is typing.
  if (q !== shownQ) {
    setShownQ(q);
    setValue(q);
  }
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const apply = (next: string) => {
    window.clearTimeout(timer.current);
    const trimmed = next.trim();
    if (trimmed === q) return;
    const separator = base.includes('?') ? '&' : '?';
    const href = trimmed === '' ? base : `${base}${separator}q=${encodeURIComponent(trimmed)}`;
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    apply(value);
  };

  return (
    <form role="search" onSubmit={onSubmit} className="mb-4">
      <ListSearch
        id="organizations-search"
        label={label}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(event) => {
          const next = event.currentTarget.value;
          setValue(next);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            apply(next);
          }, PAUSE);
        }}
        data-testid="organizations-search"
      />
      <p role="status" className="sr-only" data-testid="organizations-result-count">
        {resultText}
      </p>
    </form>
  );
}
