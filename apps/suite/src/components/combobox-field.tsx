'use client';
import { FieldError, Icon, cn, fieldInputClasses } from '@jadarat/ui';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
}

export interface ComboboxTexts {
  /** The placeholder while nothing is chosen: «اكتب للبحث» / "Type to search". */
  readonly typeToSearch: string;
  /** Nothing matches what was typed. */
  readonly noMatches: string;
}

/**
 * A long list with a search box (role-play feedback #4, PO 27 Oct 2026: «while I select the country I
 * need a search above the list»): the same look and contract as SelectField — label, hint and error — but
 * the field is a text box that filters the choices as you type (WAI-ARIA combobox with a listbox). Arrow
 * keys move, Enter picks, Escape closes; leaving the field with text that matches nothing puts the chosen
 * label back. The chosen value travels in a hidden input under `name`, like a select.
 */
export function ComboboxField({
  id,
  name,
  label,
  marker,
  tag,
  hint,
  error,
  value,
  options,
  disabled,
  required,
  texts,
  onChange,
  className,
  ...rest
}: {
  readonly id: string;
  readonly name?: string | undefined;
  readonly label: string;
  readonly marker?: string | undefined;
  readonly tag?: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly value: string;
  readonly options: readonly ComboboxOption[];
  readonly disabled?: boolean | undefined;
  readonly required?: boolean | undefined;
  readonly texts: ComboboxTexts;
  readonly onChange: (value: string) => void;
  readonly className?: string | undefined;
  readonly 'data-testid'?: string | undefined;
}) {
  const listId = useId();
  const chosen = options.find((option) => option.value === value) ?? null;
  const label_ = chosen?.label ?? '';
  // What the person typed since opening the list; null while not typing, so the field shows the chosen
  // label and follows the value (a preset, an undo) without an effect.
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = typed ?? label_;

  const needle = (typed ?? '').trim().toLocaleLowerCase();
  const matches =
    open && needle !== ''
      ? options.filter((option) => option.label.toLocaleLowerCase().includes(needle))
      : options;
  const activeOption = matches[Math.min(active, Math.max(matches.length - 1, 0))] ?? null;
  const activeId = open && activeOption ? `${listId}-${activeOption.value}` : null;
  // The list scrolls; the highlighted choice stays in view for keyboard and screen-reader users.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const pick = (option: ComboboxOption) => {
    onChange(option.value);
    setTyped(null);
    setOpen(false);
  };
  const close = () => {
    setOpen(false);
    setTyped(null);
  };
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('relative flex min-w-0 flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm font-semibold"
      >
        {label}
        {marker ? <span className="font-normal text-text-subtle">{marker}</span> : null}
        {tag}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId ?? undefined}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          placeholder={texts.typeToSearch}
          value={query}
          disabled={disabled}
          className={cn(fieldInputClasses, 'pe-10', Boolean(error) && 'border-danger')}
          onFocus={() => {
            setOpen(true);
            setActive(
              Math.max(
                0,
                options.findIndex((option) => option.value === value),
              ),
            );
          }}
          onChange={(event) => {
            setTyped(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => {
            close();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActive((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Home' && open) {
              event.preventDefault();
              setActive(0);
            } else if (event.key === 'End' && open) {
              event.preventDefault();
              setActive(Math.max(matches.length - 1, 0));
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (activeOption) pick(activeOption);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              close();
            }
          }}
          data-testid={rest['data-testid']}
        />
        <Icon
          name={open ? 'chevron-down' : 'search'}
          className="pointer-events-none absolute end-3.5 top-1/2 size-5 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        {name ? <input type="hidden" name={name} value={value} /> : null}
        {/* The keyboard works through the combobox input (WAI-ARIA pattern); the list takes mouse picks. */}
        <div
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          hidden={!open}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-surface-raised p-1 shadow-3"
          onMouseDown={(event) => {
            // Keep the input's focus while picking with the mouse (blur would close the list first).
            event.preventDefault();
          }}
        >
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-muted">{texts.noMatches}</div>
          ) : (
            matches.map((option) => {
              const isActive = activeOption?.value === option.value;
              const isChosen = option.value === value;
              return (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard picks go through the input (Enter)
                <div
                  key={option.value}
                  id={`${listId}-${option.value}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={isChosen}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 rounded px-3 py-2 text-[15px]',
                    isActive && 'bg-primary-subtle text-primary-text',
                  )}
                  onMouseEnter={() => {
                    setActive(matches.indexOf(option));
                  }}
                  onClick={() => {
                    pick(option);
                  }}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {isChosen ? <Icon name="check" className="size-4 shrink-0" /> : null}
                </div>
              );
            })
          )}
        </div>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="m-0 text-[13.5px] text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}
