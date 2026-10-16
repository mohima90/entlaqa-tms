import { JadaratMark, cn } from '@jadarat/ui';
import type { ReactNode } from 'react';
import { AuthIcon, type AuthIconName } from './auth-icons';

/**
 * The page frame of the public sign-in pages, copied from Kawadir ATS's auth screens one-to-one (PO, 16 Oct
 * 2026: `(auth)/login`, `signup`, `forgot-password`, `reset-password`), in Jadarat's theme tokens:
 *
 *   split     sign-in — the form column (logo, portal line, «Welcome back», a glass card, footer) and, from
 *             `lg`, the brand panel (55 %) with the product's promise and features;
 *   simple    forgot / reset password — the form column with the logo row and, from `lg`, a half-width brand
 *             panel with one icon, a title and a sentence;
 *   centered  sign-up with an invitation code — one centred card on a soft gradient.
 *
 * The language switch floats at the top end (Kawadir), always reachable. Plain component (no server or
 * client APIs): pages and client views pass translated texts. CSS logical properties only (RTL).
 */
export interface AuthShellTexts {
  /** «جدارات · التدريب» / "Jadarat · Training". */
  readonly productName: string;
  /** «إدارة التدريب» / "Training management". */
  readonly portal: string;
  readonly poweredBy: string;
  readonly entlaqa: string;
}

export interface AuthPanelTexts {
  readonly title: string;
  readonly accent?: string;
  readonly text: string;
  readonly features?: readonly { readonly icon: AuthIconName; readonly text: string }[];
  /** The `simple` panel's icon. */
  readonly icon?: AuthIconName;
}

export interface AuthShellProps {
  readonly variant: 'split' | 'simple' | 'centered';
  readonly texts: AuthShellTexts;
  /** The floating language switch (AuthLanguageSwitch). */
  readonly languageSwitch: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** `centered`: the card's icon tile. */
  readonly icon?: AuthIconName;
  readonly panel?: AuthPanelTexts;
  /** Notices above the card (e.g. «تم تعيين كلمة المرور»). */
  readonly notices?: ReactNode;
  readonly children: ReactNode;
  /** Under the card (e.g. "Have an invitation code?"). */
  readonly after?: ReactNode;
}

/** The floating language switch: a 44 px globe button at the top end (Kawadir). */
export function AuthLanguageSwitch({
  href,
  lang,
  label,
  ariaLabel,
}: {
  readonly href: string;
  readonly lang: string;
  readonly label: string;
  readonly ariaLabel: string;
}) {
  return (
    <a
      href={href}
      hrefLang={lang}
      lang={lang}
      aria-label={ariaLabel}
      title={label}
      className="inline-flex size-11 items-center justify-center rounded-xl border border-border bg-surface/80 text-text-muted no-underline shadow-1 backdrop-blur-sm hover:bg-surface hover:text-text"
      data-testid="language-toggle"
    >
      <AuthIcon name="globe" className="size-5" />
    </a>
  );
}

/** The Jadarat logo tile and product name (the organization's own logo replaces it later, FR-ADM-07). */
function BrandLogo({ texts, size = 'lg' }: { texts: AuthShellTexts; size?: 'lg' | 'md' }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-xl bg-nav-gradient text-on-nav shadow-2',
          size === 'lg' ? 'size-12' : 'size-11',
        )}
      >
        <JadaratMark className={size === 'lg' ? 'size-7' : 'size-6'} />
      </span>
      <span className={cn('font-bold text-primary-text', size === 'lg' ? 'text-2xl' : 'text-xl')}>
        {texts.productName}
      </span>
    </span>
  );
}

/** «إدارة التدريب · بدعم من ENTLAQA» — what this portal is and who operates it (Kawadir's context line). */
function PortalLine({ texts, className }: { texts: AuthShellTexts; className?: string }) {
  return (
    <p className={cn('m-0 flex flex-wrap items-center gap-2 text-xs', className)}>
      <span className="font-semibold uppercase tracking-[0.14em] text-text-muted">
        {texts.portal}
      </span>
      <span className="text-text-subtle" aria-hidden="true">
        ·
      </span>
      <span className="text-text-muted">
        {texts.poweredBy}{' '}
        <span className="font-semibold text-primary-text" lang="en">
          {texts.entlaqa}
        </span>
      </span>
    </p>
  );
}

function Footer({ texts }: { texts: AuthShellTexts }) {
  return (
    <footer className="mt-8 text-center text-sm text-text-muted">
      {texts.poweredBy}{' '}
      <span className="font-semibold text-primary-text" lang="en">
        {texts.entlaqa}
      </span>{' '}
      &middot; {texts.portal}
    </footer>
  );
}

/** Soft background shapes behind the form column (decorative). */
function Mesh() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute end-0 top-0 size-[500px] max-w-full rounded-full bg-primary opacity-[0.05] blur-3xl" />
      <div className="absolute bottom-0 start-0 size-[400px] max-w-full rounded-full bg-accent opacity-[0.04] blur-3xl" />
    </div>
  );
}

function SplitPanel({ panel, texts }: { panel: AuthPanelTexts; texts: AuthShellTexts }) {
  return (
    <aside
      className="relative hidden overflow-hidden bg-nav-gradient text-on-nav lg:flex lg:w-[55%]"
      aria-label={panel.title}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -end-20 -top-20 size-[400px] rounded-full bg-on-nav opacity-[0.06]" />
        <div className="absolute -start-16 top-[30%] size-[300px] rounded-full bg-on-nav opacity-[0.05]" />
        <div className="absolute bottom-[10%] end-[20%] size-[250px] rounded-full bg-on-nav opacity-[0.04]" />
      </div>
      <div className="relative z-10 flex w-full flex-col justify-center px-10 xl:px-16">
        <div className="max-w-xl">
          <span className="mb-8 inline-flex size-16 items-center justify-center rounded-2xl bg-on-nav/15">
            <JadaratMark className="size-9" />
          </span>
          <h2 className="mb-6 mt-0 text-4xl font-bold leading-tight xl:text-5xl">
            {panel.title}
            {panel.accent ? (
              <>
                <br />
                <span className="font-light text-on-nav-muted">{panel.accent}</span>
              </>
            ) : null}
          </h2>
          <p className="mb-10 mt-0 max-w-md text-lg leading-relaxed text-on-nav-muted xl:text-xl">
            {panel.text}
          </p>
          {panel.features ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {panel.features.map((feature) => (
                <li
                  key={feature.text}
                  className="flex items-center gap-4 rounded-2xl border border-on-nav/10 bg-on-nav/[0.08] p-4"
                >
                  <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-on-nav/15">
                    <AuthIcon name={feature.icon} className="size-5" />
                  </span>
                  <span className="text-[15px] font-medium">{feature.text}</span>
                  <AuthIcon name="check" className="ms-auto size-5 shrink-0 text-on-nav-muted" />
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mb-0 mt-12 border-t border-on-nav/10 pt-8 text-sm text-on-nav-muted">
            {texts.poweredBy}{' '}
            <span className="font-semibold text-on-nav" lang="en">
              {texts.entlaqa}
            </span>
          </p>
        </div>
      </div>
    </aside>
  );
}

function SimplePanel({ panel }: { panel: AuthPanelTexts }) {
  return (
    <aside
      className="relative hidden items-center justify-center overflow-hidden bg-nav-gradient text-on-nav lg:flex lg:flex-1"
      aria-label={panel.title}
    >
      <div className="relative z-10 px-12 text-center">
        <span className="mx-auto mb-8 flex size-20 items-center justify-center rounded-2xl bg-on-nav/20">
          <AuthIcon name={panel.icon ?? 'lock'} className="size-10" />
        </span>
        <h2 className="mb-4 mt-0 text-3xl font-bold">{panel.title}</h2>
        <p className="m-0 mx-auto max-w-md text-lg text-on-nav-muted">{panel.text}</p>
      </div>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -end-1/4 -top-1/4 size-1/2 rounded-full bg-on-nav opacity-10" />
        <div className="absolute -bottom-1/4 -start-1/4 size-1/2 rounded-full bg-on-nav opacity-10" />
      </div>
    </aside>
  );
}

export function AuthShell(props: AuthShellProps) {
  const { variant, texts, languageSwitch, title, subtitle, notices, children, after } = props;

  if (variant === 'centered') {
    return (
      <div className="relative flex min-h-dvh items-center justify-center bg-surface-sunken px-4 py-16">
        <div className="fixed end-4 top-4 z-50">{languageSwitch}</div>
        <main id="main" className="flex w-full max-w-md flex-col gap-4">
          <div className="flex justify-center">
            <BrandLogo texts={texts} size="md" />
          </div>
          {notices}
          <section className="rounded-2xl border border-border bg-surface p-6 shadow-2 sm:p-8">
            <div className="mb-6 flex flex-col items-center gap-1 text-center">
              <span className="mb-3 inline-flex size-12 items-center justify-center rounded-xl bg-nav-gradient text-on-nav">
                <AuthIcon name={props.icon ?? 'userPlus'} className="size-6" />
              </span>
              <h1 className="m-0 text-2xl font-bold">{title}</h1>
              {subtitle ? <div className="m-0 text-text-muted">{subtitle}</div> : null}
            </div>
            {children}
          </section>
          {after}
          <PortalLine texts={texts} className="justify-center" />
        </main>
      </div>
    );
  }

  const split = variant === 'split';
  return (
    <div className="relative flex min-h-dvh bg-bg">
      <div className="fixed end-4 top-4 z-50">{languageSwitch}</div>
      <div
        className={cn(
          'relative flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 md:px-8',
          split ? 'items-center' : 'lg:px-16 xl:px-24',
        )}
      >
        {split ? <Mesh /> : null}
        <main
          id="main"
          className={cn('relative z-10 mx-auto w-full', split ? 'max-w-[420px]' : 'max-w-md')}
        >
          {split ? (
            <div className="mb-10 flex flex-col items-center gap-4">
              <BrandLogo texts={texts} />
              <PortalLine texts={texts} className="justify-center" />
            </div>
          ) : (
            <div className="mb-8 flex flex-col gap-2">
              <BrandLogo texts={texts} size="md" />
              <PortalLine texts={texts} />
            </div>
          )}
          <div className="mb-8">
            <h1
              className={cn(
                'm-0 font-bold leading-tight tracking-tight',
                split ? 'text-[32px]' : 'text-3xl',
              )}
            >
              {title}
            </h1>
            {subtitle ? <div className="mt-2 text-[15px] text-text-muted">{subtitle}</div> : null}
          </div>
          {notices ? <div className="mb-6 flex flex-col gap-3">{notices}</div> : null}
          {split ? (
            <div className="rounded-2xl border border-border bg-surface/70 p-6 shadow-2 backdrop-blur-xl">
              {children}
            </div>
          ) : (
            children
          )}
          {after}
          <Footer texts={texts} />
        </main>
      </div>
      {props.panel ? (
        split ? (
          <SplitPanel panel={props.panel} texts={texts} />
        ) : (
          <SimplePanel panel={props.panel} />
        )
      ) : null}
    </div>
  );
}
