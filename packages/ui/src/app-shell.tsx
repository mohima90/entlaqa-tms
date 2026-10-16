'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import { Icon, JadaratMark } from './icons';
import { NavStateContext } from './nav-state';
import { rememberNavCollapsed } from './shell-preferences';
import { Tooltip, TooltipProvider } from './tooltip';

export interface AppShellProps {
  /** Product name under the organization's name, e.g. "Jadarat TMS". */
  readonly brand: ReactNode;
  /** The organization's name on top of the navigation (display only, never used for authorization). */
  readonly organization?: ReactNode;
  /** Logo on the tile; the Jadarat mark until the organization's logo exists (FR-ADM-07). */
  readonly logo?: ReactNode;
  /** The page's title in the top bar (Kawadir header title). Plain text: the page keeps its `<h1>`. */
  readonly title?: ReactNode;
  /** Top-bar items after the title (the command palette's search button). */
  readonly headerStart?: ReactNode;
  /** Top-bar items at the inline-end edge (full screen, theme, language, bell, account menu). */
  readonly headerEnd?: ReactNode;
  /** Navigation content (`NavGroup`s). Sits at the inline-start edge: right in Arabic, left in English. */
  readonly navigation: ReactNode;
  /** The bottom of the expanded navigation (`PoweredBy`). */
  readonly navigationFooter?: ReactNode;
  readonly navigationLabel: string;
  readonly skipToContentLabel: string;
  /** Label of the menu button that opens the navigation on narrow screens («القائمة» / "Menu"). */
  readonly menuLabel: string;
  /** Label of the button that closes it («إغلاق القائمة» / "Close menu"). */
  readonly closeMenuLabel: string;
  /**
   * Labels of the desktop collapse button («طيّ القائمة» / "Collapse menu", «توسيع القائمة» / "Expand
   * menu"). Without them the navigation cannot be collapsed.
   */
  readonly collapseLabels?: { readonly collapse: string; readonly expand: string } | undefined;
  /** The navigation starts collapsed (the device's remembered choice, read on the server). */
  readonly initialCollapsed?: boolean | undefined;
  readonly children: ReactNode;
}

/** Width from which the navigation is always shown (Tailwind `lg`, --bp-lg). */
const WIDE = '(min-width: 900px)';
const NAV_ID = 'app-navigation';
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Suite shell in the Kawadir layout (T-M2-43; docs/design/kawadir-alignment.md §3): a white,
 * full-height side navigation at the inline-start edge — the organization's logo and name on top,
 * grouped entries, «Powered by Jadarat» at the bottom — that collapses on a desktop from 260 px to
 * 72 px (icons with tooltips; remembered on this device), and a main column with a sticky top bar
 * (page title, search, controls) over the muted page. Logical properties only (RTL/LTR).
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
  title,
  headerStart,
  headerEnd,
  navigation,
  navigationFooter,
  navigationLabel,
  skipToContentLabel,
  menuLabel,
  closeMenuLabel,
  collapseLabels,
  initialCollapsed = false,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(Boolean(collapseLabels) && initialCollapsed);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
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

  // The collapse and expand buttons sit in different places (Kawadir): after a toggle, focus moves to
  // the one now shown, so keyboard users keep their place.
  const focusToggle = useRef(false);
  const toggleCollapsed = useCallback(() => {
    focusToggle.current = true;
    setCollapsed((was) => {
      rememberNavCollapsed(!was);
      return !was;
    });
  }, []);
  useEffect(() => {
    if (!focusToggle.current) return;
    focusToggle.current = false;
    (collapsed ? expandButton : collapseButton).current?.focus();
  }, [collapsed]);

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

  // In the phone drawer the labels are always shown: no tooltips there.
  const navState = useMemo(() => ({ collapsed: collapsed && !open }), [collapsed, open]);

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-bg lg:flex">
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
          data-nav-collapsed={navState.collapsed ? 'true' : undefined}
          role={open ? 'dialog' : undefined}
          aria-modal={open || undefined}
          aria-label={open ? menuLabel : undefined}
          className={cn(
            'w-70 shrink-0 flex-col border-e border-nav-border bg-nav-gradient text-on-nav',
            open
              ? 'fixed inset-y-0 start-0 z-50 flex max-w-[85vw] overflow-y-auto shadow-4'
              : 'hidden',
            'lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-dvh lg:max-w-none lg:shadow-none',
            'transition-[width] duration-300 ease-out motion-reduce:transition-none',
            navState.collapsed ? 'lg:w-18' : 'lg:w-65',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-3 border-b border-nav-border',
              navState.collapsed ? 'min-h-16 justify-center px-3' : 'min-h-20 px-5',
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-gradient text-on-nav-item-current shadow-1">
              {logo ?? <JadaratMark className="size-6" />}
            </span>
            <span className={cn('flex min-w-0 flex-1 flex-col', navState.collapsed && 'sr-only')}>
              {organization ? (
                <span className="line-clamp-2 text-sm font-semibold leading-snug text-text">
                  {organization}
                </span>
              ) : null}
              <span className="truncate text-xs text-on-nav">{brand}</span>
            </span>
            {collapseLabels && !navState.collapsed ? (
              <Tooltip content={collapseLabels.collapse} side="end">
                <button
                  ref={collapseButton}
                  type="button"
                  aria-label={collapseLabels.collapse}
                  aria-controls={NAV_ID}
                  aria-expanded="true"
                  onClick={toggleCollapsed}
                  data-testid="nav-collapse"
                  className="hidden size-8 shrink-0 place-items-center rounded-lg text-on-nav transition-colors hover:bg-nav-item-hover lg:grid"
                >
                  <Icon name="chevron-start" />
                </button>
              </Tooltip>
            ) : null}
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
          <nav
            aria-label={navigationLabel}
            className="flex flex-1 flex-col px-3 py-4 lg:overflow-y-auto"
          >
            <NavStateContext.Provider value={navState}>{navigation}</NavStateContext.Provider>
          </nav>
          {collapseLabels && navState.collapsed ? (
            <div className="hidden border-t border-nav-border p-3 lg:block">
              <Tooltip content={collapseLabels.expand} side="end">
                <button
                  ref={expandButton}
                  type="button"
                  aria-label={collapseLabels.expand}
                  aria-controls={NAV_ID}
                  aria-expanded="false"
                  onClick={toggleCollapsed}
                  data-testid="nav-expand"
                  className="grid h-10 w-full place-items-center rounded-xl text-on-nav transition-colors hover:bg-nav-item-hover"
                >
                  <Icon name="chevron-end" />
                </button>
              </Tooltip>
            </div>
          ) : null}
          {navigationFooter && !navState.collapsed ? (
            <div className="border-t border-nav-border p-4">{navigationFooter}</div>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col" inert={open || undefined}>
          <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b border-header-border bg-header px-4 text-on-header lg:gap-4 lg:px-6">
            <button
              ref={menuButton}
              type="button"
              aria-label={menuLabel}
              aria-expanded={open}
              aria-controls={NAV_ID}
              onClick={() => {
                setOpen(true);
              }}
              className="-ms-2 grid size-11 shrink-0 place-items-center rounded-xl text-on-header hover:bg-surface-hover lg:hidden"
            >
              <Icon name="menu" className="size-5" />
            </button>
            {title ? (
              <p
                className="m-0 hidden min-w-0 max-w-xs shrink-0 truncate text-xl font-semibold tracking-tight md:block"
                data-testid="top-bar-title"
              >
                {title}
              </p>
            ) : null}
            {headerStart}
            {headerEnd ? (
              <div className="ms-auto flex shrink-0 items-center gap-1">{headerEnd}</div>
            ) : null}
          </header>
          <main
            id="main"
            tabIndex={-1}
            className="w-full min-w-0 flex-1 px-4 py-6 text-sm lg:p-6 lg:pb-12"
          >
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export interface PoweredByProps {
  /** «مدعوم من جدارات» / "Powered by Jadarat". */
  readonly title: string;
  /** One line under it, e.g. «نظام إدارة التدريب» / "Training Management System". */
  readonly subtitle?: string | undefined;
}

/** The navigation's footer (Kawadir «Powered by …»): the Jadarat mark and the product line. */
export function PoweredBy({ title, subtitle }: PoweredByProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-sunken px-2 py-2.5">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-gradient text-on-nav-item-current"
      >
        <JadaratMark className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-semibold text-text">{title}</span>
        {subtitle ? <span className="text-[11px] text-text-muted">{subtitle}</span> : null}
      </span>
    </div>
  );
}
