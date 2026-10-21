'use client';

import { Command } from 'cmdk';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from './cn';
import { type CommandPaletteItem, groupItems, isPaletteShortcut } from './command-palette-model';
import { Icon } from './icons';

export interface CommandPaletteTexts {
  /** Visible text of the search button, e.g. "Search pages…" (also its accessible name). */
  readonly trigger: string;
  /** The dialog's name and the search field's label, e.g. "Search pages". */
  readonly title: string;
  readonly placeholder: string;
  /** Shown when nothing matches. */
  readonly empty: string;
  /** «إغلاق» / "Close". */
  readonly close: string;
  /**
   * Key hints in the dialog's footer (direction C): «للتنقل» / "to navigate", «للفتح» / "to open»,
   * «للإغلاق» / "to close". Without them there is no footer.
   */
  readonly hints?:
    { readonly navigate: string; readonly open: string; readonly close: string } | undefined;
}

export interface CommandPaletteProps {
  /** Only pages the member may open (the same list as the navigation; every page authorizes itself). */
  readonly items: readonly CommandPaletteItem[];
  readonly texts: CommandPaletteTexts;
  /** Opens the page; a full navigation by default (the shell's links are plain links too). */
  readonly onNavigate?: ((href: string) => void) | undefined;
}

/**
 * The ⌘K / Ctrl K command palette of the top bar (cmdk): a search pill that shows the shortcut, and a
 * modal search over the pages the member may open, grouped like the menu, with key hints in its footer
 * (direction C; the hints repeat what the keys do and are hidden from screen readers, which announce the
 * combobox and its options themselves). The dialog
 * is a native `<dialog>` (page inert, Tab kept inside, Escape closes) and focus returns to the
 * control that opened it. The search field is a combobox over a listbox (cmdk): arrow keys move,
 * Enter opens.
 */
export function CommandPalette({ items, texts, onNavigate }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  // ⌘ on Apple devices, Ctrl elsewhere (read in the browser; Ctrl on the server).
  const apple = useSyncExternalStore(noSubscription, isApple, () => false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const hide = useCallback(() => dialog.current?.close(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      if (dialog.current?.open) dialog.current.close();
      else show();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [show]);

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element || element.open) return;
    element.showModal();
    // The search field takes focus (React's autoFocus runs before the dialog is shown).
    input.current?.focus();
  }, [open]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return undefined;
    const onClose = () => {
      setOpen(false);
      opener.current?.focus();
      opener.current = null;
    };
    // A click on the backdrop lands on the <dialog> itself: close (Escape is the keyboard path).
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === element) element.close();
    };
    element.addEventListener('close', onClose);
    element.addEventListener('click', onBackdrop);
    return () => {
      element.removeEventListener('close', onClose);
      element.removeEventListener('click', onBackdrop);
    };
  }, []);

  const navigate =
    onNavigate ??
    ((href: string) => {
      window.location.assign(href);
    });

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        data-testid="command-palette-trigger"
        className={cn(
          // Direction C search pill: 46 px, round, the page colour, the placeholder text, Ctrl K at the end.
          'flex items-center gap-3 rounded-full border border-border bg-bg text-text-muted transition-colors hover:border-border-strong hover:text-text',
          'size-11 shrink-0 justify-center md:h-11.5 md:w-72 md:shrink md:justify-start md:px-4.5 xl:w-105',
        )}
      >
        <Icon name="search" className="size-[18px]" />
        <span className="sr-only md:not-sr-only md:flex-1 md:truncate md:text-start md:text-[15px]">
          {texts.trigger}
        </span>
        <kbd
          aria-hidden="true"
          className="hidden h-6 items-center gap-1 rounded-[7px] border border-border bg-surface px-2 font-sans text-[11.5px] font-medium md:inline-flex"
          dir="ltr"
        >
          {apple ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label={texts.title}
        data-testid="command-palette"
        className="mx-auto mt-[12vh] w-[calc(100%-1.5rem)] max-w-[620px] overflow-hidden rounded-[22px] border border-border bg-surface-raised p-0 text-text shadow-4 backdrop:bg-overlay"
      >
        {open ? (
          <Command label={texts.title} loop className="flex flex-col">
            <div className="flex min-h-15 items-center gap-3 border-b border-border px-4.5">
              <Icon name="search" className="size-5 text-text-subtle" />
              <Command.Input
                ref={input}
                placeholder={texts.placeholder}
                aria-label={texts.title}
                className="h-14 min-w-0 flex-1 border-0 bg-transparent text-[17px] text-text outline-none placeholder:text-text-subtle"
              />
              <button
                type="button"
                onClick={hide}
                aria-label={texts.close}
                className="grid size-9 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
              >
                <Icon name="close" />
              </button>
            </div>
            <Command.List className="max-h-[400px] overflow-y-auto p-2">
              <Command.Empty className="flex flex-col items-center gap-2 py-12 text-center text-text-muted">
                <Icon name="search" className="size-10 text-text-subtle" />
                <span>{texts.empty}</span>
              </Command.Empty>
              {groupItems(items).map(({ group, items: groupList }) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-text-muted"
                >
                  {groupList.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`${item.label} ${item.group} ${item.id}`}
                      onSelect={() => {
                        hide();
                        navigate(item.href);
                      }}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2 text-sm data-[selected=true]:bg-primary-subtle data-[selected=true]:font-semibold data-[selected=true]:text-primary-text"
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-surface-hover text-text-muted"
                      >
                        <Icon name={item.icon ?? 'chevron-end'} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{item.label}</span>
                        <span className="text-xs font-normal text-text-muted">{item.group}</span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            {texts.hints ? (
              <div
                aria-hidden="true"
                className="flex flex-wrap gap-4 border-t border-border bg-surface-sunken px-4.5 py-2.5 text-[13px] text-text-muted"
              >
                <KeyHint keys={['↑', '↓']} text={texts.hints.navigate} />
                <KeyHint keys={['↵']} text={texts.hints.open} />
                <KeyHint keys={['Esc']} text={texts.hints.close} />
              </div>
            ) : null}
          </Command>
        ) : null}
      </dialog>
    </>
  );
}

/** A key hint of the footer: the keys (always left to right) and what they do. */
function KeyHint({ keys, text }: { readonly keys: readonly string[]; readonly text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex gap-1" dir="ltr">
        {keys.map((key) => (
          <kbd
            key={key}
            className="rounded-[7px] border border-border bg-surface px-1.5 py-0.5 font-sans text-[11.5px] font-medium leading-none"
          >
            {key}
          </kbd>
        ))}
      </span>
      {text}
    </span>
  );
}

const noSubscription = () => () => undefined;
const isApple = () => /Mac|iPhone|iPad/.test(navigator.userAgent);
