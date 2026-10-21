import { JadaratMark, cn } from '@jadarat/ui';
import type { ReactNode, Ref } from 'react';
import { AuthIcon, type AuthIconName } from './auth-icons';

/**
 * The frames of the pages before the suite, in direction C «Bold product» (redesign package 1, PO 21 Oct
 * 2026; docs/design/redesign-direction-c.md):
 *
 *   split  the public pages (sign-in, sign-up, forgot / reset password, invitation links): the form column
 *          — the brand (or the organization's logo) and a labelled language pill on top, a 440 px body
 *          with a big title, the «Powered by ENTLAQA» footer — beside, from 900 px, an inset panel in the
 *          brand gradient (the organization's colours and sign-in picture replace it, FR-ADM-07) with
 *          the product's promise and its features as pills (`product`), or one icon, a title and a
 *          sentence (`simple`). Phones show the form only.
 *   focus  the signed-in steps and e-mailed link pages (MFA, choose an organization, MFA remove link):
 *          the brand, the language pill and Sign out on top; a 600 px column with a big title, a card
 *          and a footnote.
 *
 * Plain component (no server or client APIs): pages and client views pass translated texts. CSS logical
 * properties only (RTL).
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

/**
 * The organization's look on its sign-in pages (WP-ADM-02, FR-ADM-07): its logo instead of the Jadarat
 * brand (the «Powered by ENTLAQA» line stays — what this portal is and who runs it), and its sign-in
 * picture under the brand panel's gradient. Images are the published copies (/api/brand/<id>, same origin).
 */
export interface AuthBrand {
  /** The organization's logo, or null (the Jadarat brand). */
  readonly logoSrc: string | null;
  /** The logo's text alternative: the organization's name. */
  readonly name: string;
  /** The sign-in picture behind the panel, or null (the gradient alone). */
  readonly imageSrc: string | null;
}

export type AuthTileTone = 'brand' | 'success' | 'danger' | 'warning';

export interface AuthHeadProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** The icon tile above the title (60 px, the brand gradient or a status tint). */
  readonly icon?: AuthIconName | undefined;
  readonly iconTone?: AuthTileTone | undefined;
  /** A small caps line above the title (e.g. «المصادقة متعددة العوامل» / "Multi-factor authentication"). */
  readonly eyebrow?: ReactNode;
  /** 36 px instead of 44 px (long titles on the focused pages). */
  readonly size?: 'lg' | 'md' | undefined;
  /** Centred (a confirmation such as "Check your email"). */
  readonly centered?: boolean | undefined;
  /** Heading level: the page's `<h1>` (default) or a section's `<h2>` that replaces it. */
  readonly level?: 1 | 2 | undefined;
  /** Ref of the heading (focus moves there when a step replaces the form). */
  readonly headingRef?: Ref<HTMLHeadingElement> | undefined;
}

const TILE_TONES: Record<AuthTileTone, string> = {
  brand: 'bg-brand-gradient text-on-brand shadow-brand-glow',
  success: 'bg-success-subtle text-success',
  danger: 'bg-danger-subtle text-danger',
  warning: 'bg-warning-subtle text-warning',
};

/** The big title of a step: optional tile and eyebrow, the 44 px heading, a 16.5 px muted line. */
export function AuthHead({
  title,
  subtitle,
  icon,
  iconTone = 'brand',
  eyebrow,
  size = 'lg',
  centered = false,
  level = 1,
  headingRef,
}: AuthHeadProps) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <div className={cn('flex flex-col', centered && 'items-center text-center')}>
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            'mb-5 grid size-15 place-items-center rounded-[18px]',
            TILE_TONES[iconTone],
          )}
        >
          <AuthIcon name={icon} className="size-7" />
        </span>
      ) : null}
      {eyebrow ? (
        <p className="m-0 mb-1 text-[13px] font-bold uppercase tracking-[0.08em] text-primary-text [:lang(ar)_&]:normal-case [:lang(ar)_&]:tracking-normal">
          {eyebrow}
        </p>
      ) : null}
      <Heading
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className={cn(
          'm-0 font-bold leading-[1.1] tracking-[-0.025em] outline-none',
          size === 'lg' ? 'text-[34px] md:text-6xl' : 'text-[30px] md:text-4xl',
        )}
      >
        {title}
      </Heading>
      {subtitle ? (
        <div className="mt-3 text-[15.5px] text-text-muted md:text-[16.5px] [&_p]:m-0">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The labelled language pill (direction C): the globe and the other language's name in that language
 * («العربية» / «English»), with what it does for screen readers in the page's language.
 */
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
      className="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface px-3 text-[14.5px] font-medium text-text no-underline hover:bg-surface-hover sm:px-4"
      data-testid="language-toggle"
    >
      <AuthIcon name="globe" className="size-4" />
      <span>{label}</span>
      <span className="sr-only" lang={lang === 'ar' ? 'en' : 'ar'}>
        {' '}
        ({ariaLabel})
      </span>
    </a>
  );
}

/** The Jadarat brand (tile, product name and portal line) — or the organization's own logo (FR-ADM-07). */
function BrandLogo({
  texts,
  brand,
}: {
  readonly texts: AuthShellTexts;
  readonly brand?: AuthBrand | null | undefined;
}) {
  if (brand?.logoSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a same-origin published copy; no optimizer
      <img
        src={brand.logoSrc}
        alt={brand.name}
        className="h-10 w-auto max-w-[200px] object-contain md:h-11"
        data-testid="auth-brand-logo"
      />
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-brand-gradient text-on-brand"
      >
        <JadaratMark className="size-6" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-tight md:text-base">
          {texts.productName}
        </span>
        <span className="hidden text-[12.5px] text-text-muted md:block">{texts.portal}</span>
      </span>
    </span>
  );
}

function Footer({ texts, className }: { texts: AuthShellTexts; className?: string }) {
  return (
    <footer className={cn('text-center text-[13.5px] text-text-muted', className)}>
      {texts.poweredBy}{' '}
      <b className="font-semibold text-text" lang="en">
        {texts.entlaqa}
      </b>{' '}
      &middot; {texts.portal}
    </footer>
  );
}

/** Two faint rings in the panel's corner (decorative), in its text colour. */
function PanelRings() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -end-65 -top-55 size-155 rounded-full border border-current opacity-20" />
      <div className="absolute -end-40 -top-30 size-105 rounded-full border border-current opacity-25" />
    </div>
  );
}

/** The inset brand panel of the split frame (from 900 px): the brand gradient, large type. */
function BrandPanel({
  panel,
  imageSrc,
}: {
  panel: AuthPanelTexts;
  imageSrc?: string | null | undefined;
}) {
  const simple = !panel.features;
  return (
    <aside
      className="relative m-3.5 ms-0 hidden flex-col justify-center gap-5.5 overflow-hidden rounded-2xl bg-nav-panel px-10 py-12 text-on-nav lg:flex xl:px-15 xl:py-16"
      aria-label={panel.title}
    >
      {imageSrc ? (
        // The organization's sign-in picture (decorative) under its gradient, which keeps the text
        // readable (WP-ADM-02).
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin published copy
        <img
          src={imageSrc}
          alt=""
          className="pointer-events-none absolute inset-0 size-full object-cover opacity-15"
          data-testid="auth-brand-image"
        />
      ) : null}
      <PanelRings />
      {simple ? (
        <span
          aria-hidden="true"
          className="relative grid size-23 place-items-center rounded-[28px] border border-current/25 bg-current/15"
        >
          <AuthIcon name={panel.icon ?? 'lock'} className="size-10" />
        </span>
      ) : null}
      <h2
        className={cn(
          'relative m-0 max-w-[560px] font-bold leading-[1.08] tracking-[-0.02em]',
          simple ? 'text-4xl xl:text-6xl' : 'text-[40px] xl:text-[52px]',
        )}
      >
        {panel.title}
        {panel.accent ? <span className="block font-normal">{panel.accent}</span> : null}
      </h2>
      <p className="relative m-0 max-w-[480px] text-lg">{panel.text}</p>
      {panel.features ? (
        <ul className="relative m-0 mt-4.5 flex max-w-[560px] list-none flex-wrap gap-2.5 p-0">
          {panel.features.map((feature) => (
            <li
              key={feature.text}
              className="inline-flex items-center gap-2.5 rounded-full border border-current/25 bg-current/10 py-2.5 pe-4 ps-2.5 text-[15px] font-medium"
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full bg-nav-current text-on-nav-item-current"
              >
                <AuthIcon name={feature.icon} className="size-4" />
              </span>
              {feature.text}
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

export interface AuthShellProps extends Omit<AuthHeadProps, 'level' | 'headingRef' | 'title'> {
  /** The page's title; omit when the content renders its own `AuthHead` (e.g. to move focus to it). */
  readonly title?: ReactNode;
  readonly variant: 'split' | 'focus';
  /** The organization's look (null: Jadarat's). */
  readonly brand?: AuthBrand | null | undefined;
  readonly texts: AuthShellTexts;
  /** The labelled language pill (AuthLanguageSwitch). */
  readonly languageSwitch: ReactNode;
  /** `focus`: controls after the language pill (Sign out). */
  readonly headerEnd?: ReactNode;
  /** `split`: the brand panel's texts. */
  readonly panel?: AuthPanelTexts;
  /** Notices under the title (e.g. «تم تعيين كلمة المرور»). */
  readonly notices?: ReactNode;
  readonly children: ReactNode;
  /** Under the form (e.g. "Have an invitation code?"). */
  readonly after?: ReactNode;
  /** `split`: a wider body (520 px) for forms with two columns. */
  readonly wide?: boolean | undefined;
  readonly 'data-testid'?: string | undefined;
}

export function AuthShell(props: AuthShellProps) {
  const { variant, texts, languageSwitch, notices, children, after, brand } = props;
  // A step that replaces the page's title (e.g. "Check your email") marks itself `data-replaces-head`:
  // the title then stays for screen readers only.
  const head = props.title ? (
    <div className="group-has-[[data-replaces-head]]/auth:sr-only">
      <AuthHead
        title={props.title}
        subtitle={props.subtitle}
        icon={props.icon}
        iconTone={props.iconTone}
        eyebrow={props.eyebrow}
        size={props.size}
        centered={props.centered}
      />
    </div>
  ) : null;

  if (variant === 'focus') {
    return (
      <div className="flex min-h-dvh flex-col bg-bg bg-[radial-gradient(1000px_500px_at_50%_-10%,var(--color-primary-subtle),transparent_70%)]">
        <header className="flex items-center justify-between gap-4 px-4 py-3.5 md:px-8 md:py-4.5">
          <BrandLogo texts={texts} brand={brand} />
          <div className="flex items-center gap-2.5">
            {languageSwitch}
            {props.headerEnd}
          </div>
        </header>
        <main
          id="main"
          className="group/auth flex flex-1 justify-center px-4 pb-6 pt-5.5 md:pb-8 md:pt-10"
        >
          <div
            className="flex w-full max-w-[600px] flex-col gap-5.5"
            data-testid={props['data-testid']}
          >
            {head}
            {notices ? <div className="flex flex-col gap-3">{notices}</div> : null}
            {children}
            {after}
          </div>
        </main>
        <Footer texts={texts} className="p-4.5" />
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="flex min-w-0 flex-col px-4 pb-5 pt-4 md:px-10 md:py-6 xl:px-16 xl:py-7">
        <header className="flex items-center justify-between gap-4">
          <BrandLogo texts={texts} brand={brand} />
          {languageSwitch}
        </header>
        <main
          id="main"
          className="group/auth flex flex-1 justify-center pb-6 pt-9 md:items-center md:py-7"
        >
          <div
            className={cn(
              'flex w-full flex-col gap-5.5',
              props.wide ? 'max-w-[520px]' : 'max-w-[440px]',
            )}
            data-testid={props['data-testid']}
          >
            {head}
            {notices ? <div className="flex flex-col gap-3">{notices}</div> : null}
            {children}
            {after}
          </div>
        </main>
        <Footer texts={texts} />
      </div>
      {props.panel ? <BrandPanel panel={props.panel} imageSrc={brand?.imageSrc} /> : null}
    </div>
  );
}

/** The footnote under a focused page's card (e.g. what to do after losing the authenticator app). */
export function AuthFootnote({ children }: { readonly children: ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-2.5 text-[13.5px] text-text-muted">
      <AuthIcon name="info" className="mt-0.5 size-4 shrink-0 text-text-subtle" />
      <span>{children}</span>
    </p>
  );
}

/** The card of a focused page (600 px column). */
export function AuthCard({
  children,
  className,
  'data-testid': testId,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly 'data-testid'?: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-5 rounded-xl border border-border bg-surface p-5.5 shadow-3 md:p-8',
        className,
      )}
      data-testid={testId}
    >
      {children}
    </section>
  );
}

/** The divider and «Already have an account? Sign in»-style line under a form. */
export function AuthAlt({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <div className="h-px bg-border" role="presentation" />
      <p className="m-0 text-center text-[15px] text-text-muted [&_a]:font-bold [&_a]:text-primary-text">
        {children}
      </p>
    </>
  );
}
