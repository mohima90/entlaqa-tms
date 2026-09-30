import type { ReactNode } from 'react';

export interface AppShellProps {
  /** Suite wordmark + current module, e.g. "جدارات · التدريب". */
  readonly brand: ReactNode;
  /** Header items at the inline-end edge (tenant context, language toggle, user menu). */
  readonly headerEnd?: ReactNode;
  /** Side navigation content (links). Sits at the inline-start edge: right in Arabic, left in English. */
  readonly navigation: ReactNode;
  readonly navigationLabel: string;
  readonly skipToContentLabel: string;
  readonly children: ReactNode;
}

/**
 * Suite shell layout (docs/design/suite-shell.md §1): skip link, sticky header (56px), side navigation
 * at inline-start (264px, ≥ 900px), main content (max 1280px). Logical properties only (RTL/LTR).
 * The mobile drawer and bottom navigation come with T-M1-A02/A03.
 */
export function AppShell({
  brand,
  headerEnd,
  navigation,
  navigationLabel,
  skipToContentLabel,
  children,
}: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="absolute start-2 top-2 z-50 -translate-y-24 rounded-md bg-surface px-4 py-2 text-primary-text focus:translate-y-0"
      >
        {skipToContentLabel}
      </a>
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-border bg-surface px-4">
        <div className="min-w-0 truncate text-lg font-semibold">{brand}</div>
        {headerEnd ? <div className="flex shrink-0 items-center gap-3">{headerEnd}</div> : null}
      </header>
      <div className="flex flex-1">
        <nav
          aria-label={navigationLabel}
          className="hidden w-66 shrink-0 border-e border-border bg-surface p-4 lg:block"
        >
          {navigation}
        </nav>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full min-w-0 max-w-7xl flex-1 p-4 lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
