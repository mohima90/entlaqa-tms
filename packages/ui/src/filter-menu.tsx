'use client';

import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface FilterMenuOption {
  readonly value: string;
  readonly label: string;
  /** Indentation level (units in tree order). */
  readonly depth?: number | undefined;
}

export interface FilterMenuProps {
  /** The filter's name, e.g. «الوحدة» / "Unit". */
  readonly label: string;
  /** The value chosen now, or null (all). */
  readonly value: string | null;
  readonly options: readonly FilterMenuOption[];
  /** The first choice, which removes the filter: «كل الوحدات» / "All units". */
  readonly allLabel: string;
  readonly onChange: (value: string | null) => void;
  /** The × button's name: "Remove the filter Unit: Finance". */
  readonly removeLabel: string;
  /** Long lists get a search field first (its label). */
  readonly searchLabel?: string | undefined;
  /** Shown when the search matches nothing. */
  readonly noMatches?: string | undefined;
  /** Options from which a search field is shown (default 8). */
  readonly searchFrom?: number | undefined;
  readonly disabled?: boolean | undefined;
  readonly 'data-testid'?: string | undefined;
}

const PILL =
  'inline-flex min-h-10 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[14.5px] font-medium transition-colors pointer-coarse:min-h-11';

/**
 * A filter pill that applies at once (direction C, redesign package 3 — Attio and Mercury filter chips):
 * dashed with «+» until used, solid in the brand tint with the value and a «×» once set. The pill opens a
 * small list of the choices — with a search field for long lists — and a choice applies immediately (no
 * Apply button). Keyboard: ↑ ↓ move between the choices, ↵ picks, Esc closes and focus returns to the pill.
 */
export function FilterMenu({
  label,
  value,
  options,
  allLabel,
  onChange,
  removeLabel,
  searchLabel,
  noMatches,
  searchFrom = 8,
  disabled = false,
  'data-testid': testId,
}: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const popoverId = useId();
  const searchId = useId();
  const chosen = options.find((o) => o.value === value) ?? null;
  const withSearch = searchLabel !== undefined && options.length >= searchFrom;
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? options.filter((o) => o.label.toLocaleLowerCase().includes(needle))
    : options;

  // Outside clicks close it (the pill stays where focus was).
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // Opening moves focus into the list: the search field, else the chosen choice.
  useEffect(() => {
    if (!open) return;
    if (withSearch) {
      search.current?.focus();
      return;
    }
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button');
    const current = [...(buttons ?? [])].find((b) => b.getAttribute('aria-pressed') === 'true');
    (current ?? buttons?.[0])?.focus();
  }, [open, withSearch]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  };

  const pick = (next: string | null) => {
    close(true);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? buttons[index < 0 ? 0 : Math.min(index + 1, buttons.length - 1)]
        : index <= 0
          ? withSearch
            ? null
            : buttons[0]
          : buttons[index - 1];
    if (next) next.focus();
    else search.current?.focus();
  };

  return (
    <div ref={wrapper} className="relative inline-flex" data-testid={testId}>
      {chosen ? (
        <span className={cn(PILL, 'gap-0 border-primary bg-primary-subtle pe-1 text-primary-text')}>
          <button
            ref={trigger}
            type="button"
            aria-haspopup="true"
            aria-expanded={open}
            aria-controls={open ? popoverId : undefined}
            disabled={disabled}
            onClick={() => {
              setOpen((o) => !o);
            }}
            className="inline-flex min-h-9 items-center rounded-full pe-1.5 font-medium"
          >
            {label}: {chosen.label}
          </button>
          <button
            type="button"
            aria-label={removeLabel}
            disabled={disabled}
            onClick={() => {
              onChange(null);
              trigger.current?.focus();
            }}
            className="grid size-8 place-items-center rounded-full hover:bg-primary/15 pointer-coarse:size-10"
            data-testid={testId ? `${testId}-remove` : undefined}
          >
            <Icon name="close" className="size-3.5" />
          </button>
        </span>
      ) : (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          disabled={disabled}
          onClick={() => {
            setOpen((o) => !o);
          }}
          className={cn(
            PILL,
            'border-dashed border-border-strong text-text-muted hover:bg-surface-hover hover:text-text',
          )}
        >
          <Icon name="plus" className="size-3.5" />
          {label}
        </button>
      )}
      {open ? (
        <div
          id={popoverId}
          role="group"
          aria-label={label}
          className="absolute start-0 top-full z-[1000] mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-lg border border-border bg-surface-raised p-1.5 text-text shadow-4"
        >
          {withSearch ? (
            <div className="flex min-h-10 items-center gap-2 rounded-full border-[1.5px] border-border-strong px-3 focus-within:border-primary">
              <Icon name="search" className="size-4 text-text-subtle" />
              <label htmlFor={searchId} className="sr-only">
                {searchLabel}
              </label>
              <input
                ref={search}
                id={searchId}
                type="search"
                onKeyDown={onKeyDown}
                value={query}
                autoComplete="off"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                className="min-w-0 flex-1 border-0 bg-transparent text-[14.5px] outline-none"
              />
            </div>
          ) : null}
          <ul ref={list} className="m-0 flex max-h-72 list-none flex-col gap-0.5 overflow-auto p-0">
            {[
              ...(needle ? [] : [{ value: null, label: allLabel, depth: 0 }]),
              ...shown.map((o) => ({ value: o.value, label: o.label, depth: o.depth ?? 0 })),
            ].map((o) => {
              const selected = o.value === value;
              return (
                <li key={o.value ?? ''}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onKeyDown={onKeyDown}
                    onClick={() => {
                      pick(o.value);
                    }}
                    className={cn(
                      'flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-start text-[14.5px] outline-none hover:bg-surface-hover focus-visible:bg-surface-hover pointer-coarse:min-h-11',
                      selected && 'bg-surface-selected font-semibold text-primary-text',
                    )}
                  >
                    <span
                      className={cn(
                        'min-w-0 flex-1 [overflow-wrap:anywhere]',
                        o.depth === 1 && 'ps-4',
                        o.depth === 2 && 'ps-8',
                        o.depth >= 3 && 'ps-12',
                      )}
                    >
                      {o.label}
                    </span>
                    {selected ? <Icon name="check" className="size-4" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {needle && shown.length === 0 && noMatches ? (
            <p role="status" className="m-0 px-3 py-2 text-sm text-text-muted">
              {noMatches}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
