'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from './cn';
import { Icon, JadaratMark } from './icons';

export interface AppShellProps {
  /** Product name in the navigation's organization block, e.g. "Jadarat TMS". */
  readonly brand: ReactNode;
  /** The organization's name under the product name (display only, never used for authorization). */
  readonly organization?: ReactNode;
  /** Logo on the white tile; the Jadarat mark until the organization's logo exists (FR-ADM-07). */
  readonly logo?: ReactNode;
  /** Top-bar items at the inline-end edge (language switch, account, sign-out). */
  readonly headerEnd?: ReactNode;
  /** Navigation content (`NavGroup`s). Sits at the inline-start edge: right in Arabic, left in English. */
  readonly navigation: ReactNode;
  readonly navigationLabel: string;
  readonly skipToContentLabel: string;
  /** Label of the menu button that opens the navigation on narrow screens («القائمة» / "Menu"). */
  readonly menuLabel: string;
  /** Label of the button that closes it («إغلاق القائمة» / "Close menu"). */
  readonly closeMenuLabel: string;
  readonly children: ReactNode;
}

/** Width from which the navigation is always shown (Tailwind `lg`, --bp-lg). */
const WIDE = '(min-width: 900px)';
const NAV_ID = 'app-navigation';
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Suite shell, approved design «Meridian» (T-M2-21; docs/design/suite-shell.md): a full-height side
 * navigation on the Jadarat gradient (organization block with the logo tile, product and organization
 * names, then grouped entries) at the inline-start edge, and a main column with a white top bar and the
 * page (max 1280 px). Logical properties only (RTL/LTR).
 *
 * Below 900 px the navigation is a drawer behind a menu button (disclosure: `aria-expanded`,
 * `aria-controls`): open, it is a modal dialog — focus moves into it and Tab loops inside, the rest of
 * the page (skip link included) is `inert`; Escape, the close button or the scrim close it and return
 * focus to the menu button. Touch targets are ≥ 44 px.
 */
export function AppShell({
  brand,
  organization,
  logo,
  headerEnd,
  navigation,
  navigationLabel,
  skipToContentLabel,
  menuLabel,
  closeMenuLabel,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  // Focus goes back to the menu button once the drawer is closed and the page is no longer inert.
  const restoreFocus = useRef(false);
  const close = useCallback(() => {
    restoreFocus.current = true;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    menuButton.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    closeButton.current?.focus();
    const focusable = () =>
      [...(drawer.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => el.getClientRects().length > 0,
      );
    const onKey = (event: KeyboardEvent) => {
      // Another modal opened over the drawer (e.g. the idle-session warning) handles its own keys.
      if (document.activeElement?.closest('dialog[open]')) return;
      if (event.key === 'Escape') {
        close();
        return;
      }
      // Modal drawer: Tab and Shift+Tab loop inside it.
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !drawer.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !drawer.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    // Widening the window shows the navigation in place: the drawer state no longer applies. Focus
    // stays on its entry; from the close button (hidden when wide) it moves to the current entry or
    // the first one, never to the page's body.
    const wide = window.matchMedia(WIDE);
    const onWide = () => {
      if (!wide.matches) return;
      const active = document.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        active === closeButton.current ||
        !drawer.current?.contains(active)
      ) {
        const entry =
          drawer.current?.querySelector<HTMLElement>('nav [aria-current="page"]') ??
          drawer.current?.querySelector<HTMLElement>('nav a[href]');
        entry?.focus();
      }
      restoreFocus.current = false;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open, close]);

  return (
    <div className="min-h-dvh bg-surface lg:flex">
      <a
        href="#main"
        inert={open || undefined}
        className="absolute start-2 top-2 z-[60] -translate-y-24 rounded-md bg-surface px-4 py-2 text-primary-text focus:translate-y-0"
      >
        {skipToContentLabel}
      </a>
      {open ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-overlay lg:hidden"
          onClick={close}
        />
      ) : null}
      {/* A plain container (the <nav> inside is the landmark); while open on a phone it is a modal
          dialog named like the menu button. */}
      <div
        ref={drawer}
        id={NAV_ID}
        data-nav-scope=""
        role={open ? 'dialog' : undefined}
        aria-modal={open || undefined}
        aria-label={open ? menuLabel : undefined}
        className={cn(
          'w-66 shrink-0 flex-col gap-1 border-e border-nav-border bg-nav-gradient p-3 text-on-nav',
          open
            ? 'fixed inset-y-0 start-0 z-50 flex max-w-[85vw] overflow-y-auto shadow-4'
            : 'hidden',
          'lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-dvh lg:max-w-none lg:overflow-y-auto lg:shadow-none',
        )}
      >
        <div className="flex min-h-11 items-center gap-2.5 px-1">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-nav-item-current text-on-nav-item-current">
            {logo ?? <JadaratMark />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{brand}</span>
            {organization ? (
              <span className="truncate text-xs text-on-nav-muted">{organization}</span>
            ) : null}
          </span>
          <button
            ref={closeButton}
            type="button"
            aria-label={closeMenuLabel}
            onClick={close}
            className="grid size-11 shrink-0 place-items-center rounded-md text-on-nav hover:bg-nav-item-hover lg:hidden"
          >
            <Icon name="close" className="size-5" />
          </button>
        </div>
        <nav aria-label={navigationLabel} className="mt-2 flex flex-col">
          {navigation}
        </nav>
      </div>
      <div className="flex min-w-0 flex-1 flex-col" inert={open || undefined}>
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-header-border bg-header px-4 text-on-header lg:px-6">
          <button
            ref={menuButton}
            type="button"
            aria-label={menuLabel}
            aria-expanded={open}
            aria-controls={NAV_ID}
            onClick={() => {
              setOpen(true);
            }}
            className="-ms-2 grid size-11 shrink-0 place-items-center rounded-md text-on-header hover:bg-surface-hover lg:hidden"
          >
            <Icon name="menu" className="size-5" />
          </button>
          {/* Product name next to the menu button on tablets; on phones the drawer shows it (room for the controls). */}
          <span className="hidden min-w-0 truncate text-sm font-semibold md:block lg:hidden">
            {brand}
          </span>
          {headerEnd ? (
            <div className="ms-auto flex shrink-0 items-center gap-2">{headerEnd}</div>
          ) : null}
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-6 text-sm lg:px-8 lg:pb-12"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
