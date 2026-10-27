'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import { Icon, JadaratMark } from './icons';
import { NavStateContext } from './nav-state';
import { rememberNavCollapsed } from './shell-preferences';
import { Tooltip, TooltipProvider } from './tooltip';

export interface AppShellProps {
  /** Product name, under the organization's name when no detail is given, e.g. "Jadarat TMS". */
  readonly brand: ReactNode;
  /** The organization's name on top of the navigation (display only, never used for authorization). */
  readonly organization?: ReactNode;
  /** The organization's initials for its tile (e.g. "DO"); the Jadarat mark without them. */
  readonly organizationInitials?: string | undefined;
  /** The line under the organization's name (the member's role, e.g. "Organization Admin"). */
  readonly organizationDetail?: ReactNode;
  /**
   * The organization's logo (an `<img>` with its alt text, FR-ADM-07): it replaces the tile and the name
   * at the top of the navigation (the name stays for screen readers), and fills the collapsed tile.
   */
  readonly logo?: ReactNode;
  /** Top-bar items after the menu toggles (the page search). */
  readonly headerStart?: ReactNode;
  /** Top-bar items at the inline-end edge (theme, language, bell, account menu). */
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
   * Labels of the desktop collapse toggle in the top bar («طيّ القائمة» / "Collapse menu», «توسيع
   * القائمة» / "Expand menu"). Without them the navigation cannot be collapsed.
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
 * The suite shell in direction C «Bold product» (redesign package 1, PO 21 Oct 2026;
 * docs/design/redesign-direction-c.md): a full-height side navigation in the brand gradient at the
 * inline-start edge — the organization's chip on top (tile, name, the member's role), grouped entries
 * with the current page as a white pill, «Powered by Jadarat» at the bottom — that collapses on a desktop
 * from 264 px to an 84 px rail (icons with tooltips; remembered on this device) with the toggle at the
 * start of the white top bar (page search, theme, language, notifications, account). The organization's
 * colours replace the gradient (FR-ADM-07). Logical properties only (RTL/LTR).
 *
 * Below 900 px the navigation is a drawer behind a menu button (disclosure: `aria-expanded`,
 * `aria-controls`): open, it is a modal dialog — focus moves into it and Tab loops inside, the rest of
 * the page (skip link included) is `inert`; Escape, the close button or the scrim close it and return
 * focus to the menu button. Touch targets are ≥ 44 px.
 */
export function AppShell({
  brand,
  organization,
  organizationInitials,
  organizationDetail,
  logo,
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

  // One toggle in the top bar: it keeps focus, its name and `aria-expanded` follow the state.
  const toggleCollapsed = useCallback(() => {
    setCollapsed((was) => {
      rememberNavCollapsed(!was);
      return !was;
    });
  }, []);

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
  const toggleLabel = collapseLabels
    ? collapsed
      ? collapseLabels.expand
      : collapseLabels.collapse
    : '';

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-bg lg:flex">
        <a
          href="#main"
          inert={open || undefined}
          className="absolute start-2 top-2 z-[60] -translate-y-24 rounded-full bg-surface px-4 py-2 font-semibold text-primary-text shadow-2 focus:translate-y-0"
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
            'w-78 shrink-0 flex-col gap-3.5 bg-nav-gradient px-3.5 py-4.5 text-on-nav',
            open
              ? 'fixed inset-y-0 start-0 z-50 flex max-w-[86vw] overflow-y-auto rounded-e-xl shadow-4'
              : 'hidden',
            'lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-dvh lg:max-w-none lg:rounded-none lg:shadow-none',
            'transition-[width] duration-[var(--duration-slow)] ease-[var(--easing-standard)] motion-reduce:transition-none',
            navState.collapsed ? 'lg:w-21 lg:items-center lg:px-3' : 'lg:w-66',
          )}
        >
          {/* The organization's chip (direction C): its tile (logo or initials), name and the member's
              role. Display only: switching organization is not in the suite yet. */}
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex min-w-0 flex-1 items-center gap-3',
                // The organization's logo stands on its own (role-play feedback, PO 27 Oct 2026: no box
                // around it); the initials tile keeps its chip.
                logo ? 'p-1' : 'rounded-lg border border-nav-border bg-on-nav/10 p-2',
                navState.collapsed && 'flex-none justify-center p-1.5',
              )}
            >
              {logo && !navState.collapsed ? (
                <span className="flex h-12 min-w-0 flex-1 items-center [&>img]:max-h-11 [&>img]:w-auto [&>img]:max-w-full [&>img]:object-contain">
                  {logo}
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-nav-current text-sm font-bold text-on-nav-item-current [&>img]:max-h-full [&>img]:object-contain"
                >
                  {logo ?? organizationInitials ?? <JadaratMark className="size-6" />}
                </span>
              )}
              <span
                className={cn(
                  'flex min-w-0 flex-1 flex-col',
                  (navState.collapsed || Boolean(logo)) && 'sr-only',
                )}
              >
                {organization ? (
                  <span
                    className="truncate text-[15px] font-semibold leading-tight"
                    data-testid="nav-wordmark"
                  >
                    {organization}
                  </span>
                ) : null}
                <span className="truncate text-[12.5px] leading-snug">
                  {organizationDetail ?? brand}
                </span>
              </span>
            </div>
            <button
              ref={closeButton}
              type="button"
              aria-label={closeMenuLabel}
              onClick={close}
              className="grid size-11 shrink-0 place-items-center rounded-full text-on-nav hover:bg-nav-item-hover lg:hidden"
            >
              <Icon name="close" className="size-5" />
            </button>
          </div>
          <nav
            aria-label={navigationLabel}
            className="-mx-1 flex flex-1 flex-col px-1 lg:min-h-0 lg:overflow-y-auto"
          >
            <NavStateContext.Provider value={navState}>{navigation}</NavStateContext.Provider>
          </nav>
          {navigationFooter && !navState.collapsed ? <div>{navigationFooter}</div> : null}
          {navigationFooter && navState.collapsed ? (
            <span
              aria-hidden="true"
              className="hidden size-10 shrink-0 place-items-center rounded-[12px] bg-on-nav/10 lg:grid"
            >
              <span className="grid size-7 place-items-center rounded-md bg-nav-current text-on-nav-item-current">
                <JadaratMark className="size-4" />
              </span>
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col" inert={open || undefined}>
          <header className="sticky top-0 z-30 flex min-h-16 items-center gap-1 border-b border-header-border bg-header px-2.5 text-on-header md:gap-3 lg:min-h-18 lg:ps-7 lg:pe-5">
            <button
              ref={menuButton}
              type="button"
              aria-label={menuLabel}
              aria-expanded={open}
              aria-controls={NAV_ID}
              onClick={() => {
                setOpen(true);
              }}
              className="grid size-11 shrink-0 place-items-center rounded-full text-on-header hover:bg-surface-hover lg:hidden"
            >
              <Icon name="menu" className="size-5" />
            </button>
            {collapseLabels ? (
              <Tooltip content={toggleLabel} side="bottom">
                <button
                  type="button"
                  aria-label={toggleLabel}
                  aria-controls={NAV_ID}
                  aria-expanded={!collapsed}
                  onClick={toggleCollapsed}
                  data-testid="nav-collapse"
                  className="-ms-2.5 hidden size-10 shrink-0 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-hover hover:text-text lg:grid"
                >
                  <Icon name="sidebar" className="size-5" />
                </button>
              </Tooltip>
            ) : null}
            {headerStart}
            {headerEnd ? (
              <div className="ms-auto flex shrink-0 items-center gap-1 md:gap-2">{headerEnd}</div>
            ) : null}
          </header>
          <main
            id="main"
            tabIndex={-1}
            className="w-full min-w-0 flex-1 px-4 pb-7 pt-4.5 text-sm md:px-6 lg:px-8 lg:pb-10 lg:pt-7"
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

/** The navigation's footer («Powered by …»): the Jadarat mark and the product line, on the gradient. */
export function PoweredBy({ title, subtitle }: PoweredByProps) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-on-nav/10 p-3 text-on-nav">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-md bg-nav-current text-on-nav-item-current"
      >
        <JadaratMark className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13.5px] font-semibold">{title}</span>
        {subtitle ? <span className="text-[12.5px] leading-snug">{subtitle}</span> : null}
      </span>
    </div>
  );
}
