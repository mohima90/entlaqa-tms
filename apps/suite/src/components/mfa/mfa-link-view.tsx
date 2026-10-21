'use client';
import { Alert, Button, Icon, buttonClasses } from '@jadarat/ui';
import { useEffect, useRef, useState, useTransition } from 'react';
import { openMfaRemoveLinkAction } from '../../auth/mfa';
import { type MfaLinkOutcome, mfaLinkFragment, mfaLinkTokenFromHash } from '../../lib/mfa-link';
import { AuthSpinner } from '../auth/auth-field';
import type { AuthIconName } from '../auth/auth-icons';
import {
  AuthCard,
  type AuthBrand,
  AuthHead,
  AuthLanguageSwitch,
  AuthShell,
  type AuthShellTexts,
  type AuthTileTone,
} from '../auth/auth-shell';
import { type ErrorTexts, errorText } from '../auth/error-text';

/**
 * The authenticator set-up e-mail's "not you? remove this app" link (FR-IAM-12, T-M2-10; security review H1):
 * removes that app and ends every sign-in session of the account. No session needed: opening the e-mailed
 * link proves the mailbox. The token is read from the URL fragment, removed from the address bar at once,
 * kept in memory only and sent in the body of the action after a click — opening the page changes nothing
 * (mail scanners). The database makes the link single use. The page links only to fixed pages of the suite
 * (no redirect parameter).
 */
export interface MfaLinkTexts {
  readonly pageTitle: string;
  readonly opening: string;
  readonly intro: string;
  /** Shown before the click: what else happens. */
  readonly warning: string;
  readonly submit: string;
  readonly submitting: string;
  readonly doneTitle: string;
  readonly doneText: string;
  readonly expiredTitle: string;
  readonly expiredText: string;
  readonly invalidTitle: string;
  readonly invalidText: string;
  /** Whatever the answer: set a new password (the forgot-password page). */
  readonly newPassword: string;
  readonly signIn: string;
}

type View =
  | { readonly kind: 'opening' }
  | { readonly kind: 'ready'; readonly token: string }
  | { readonly kind: 'done'; readonly outcome: MfaLinkOutcome };

export function MfaLinkView({
  locale,
  brand,
  shell,
  toggle,
  texts,
  errors,
}: {
  readonly locale: 'ar' | 'en';
  /** The organization's look (logo; WP-ADM-02), or null for Jadarat's. */
  readonly brand: AuthBrand | null;
  /** The frame's texts (product name, portal line, footer). */
  readonly shell: AuthShellTexts;
  /** The language switch: its target (locale-prefixed path without the fragment) and texts. */
  readonly toggle: {
    readonly href: string;
    readonly lang: string;
    /** Visible, and so part of its accessible name (WCAG 2.5.3). */
    readonly label: string;
    readonly ariaLabel: string;
  };
  readonly texts: MfaLinkTexts;
  readonly errors: ErrorTexts;
}) {
  const [view, setView] = useState<View>({ kind: 'opening' });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { hash, pathname, search } = window.location;
    const token = mfaLinkTokenFromHash(hash);
    if (hash !== '') {
      window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    }
    setView(token ? { kind: 'ready', token } : { kind: 'done', outcome: 'invalid' });
  }, []);

  // The answer replaces the page's content: move the focus to its heading (announced by screen readers).
  useEffect(() => {
    if (view.kind === 'done') heading.current?.focus();
  }, [view.kind]);

  function submit(token: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await openMfaRemoveLinkAction({ token });
      if (result.ok) setView({ kind: 'done', outcome: result.value.outcome });
      else setMessage(errorText(result.error, errors));
    });
  }

  let title = texts.pageTitle;
  let icon: AuthIconName = 'shield';
  let tone: AuthTileTone = 'warning';
  let body;
  if (view.kind === 'opening') {
    body = (
      <AuthCard>
        <p
          className="m-0 flex items-center gap-3 text-text-muted"
          role="status"
          data-testid="mfa-link-opening"
        >
          <AuthSpinner />
          {texts.opening}
        </p>
      </AuthCard>
    );
  } else if (view.kind === 'ready') {
    body = (
      <AuthCard>
        <p className="m-0">{texts.intro}</p>
        <Alert tone="warning">{texts.warning}</Alert>
        {message ? (
          <Alert tone="danger" data-testid="mfa-link-error">
            {message}
          </Alert>
        ) : null}
        <div>
          <Button
            type="button"
            variant="danger"
            size="lg"
            disabled={pending}
            busy={pending}
            onClick={() => {
              submit(view.token);
            }}
            data-testid="mfa-link-submit"
          >
            {pending ? null : <Icon name="trash" />}
            {pending ? texts.submitting : texts.submit}
          </Button>
        </div>
      </AuthCard>
    );
  } else {
    const { outcome } = view;
    const done = outcome === 'removed';
    title = done
      ? texts.doneTitle
      : outcome === 'expired'
        ? texts.expiredTitle
        : texts.invalidTitle;
    icon = done ? 'shield' : 'alert';
    tone = done ? 'success' : 'danger';
    const text = done
      ? texts.doneText
      : outcome === 'expired'
        ? texts.expiredText
        : texts.invalidText;
    // "Not you?": whatever the answer, a new password comes first (someone may know the current one).
    body = (
      <AuthCard data-testid={`mfa-link-${outcome}`}>
        <Alert tone="warning">{text}</Alert>
        <div className="flex flex-wrap gap-2.5">
          <a
            href={`/${locale}/forgot-password`}
            className={buttonClasses({ variant: 'primary', size: 'lg' })}
            data-testid="mfa-link-new-password"
          >
            {texts.newPassword}
            <Icon name="arrow-end" />
          </a>
          <a
            href={`/${locale}/sign-in`}
            className={buttonClasses({ variant: 'secondary', size: 'lg' })}
          >
            {texts.signIn}
          </a>
        </div>
      </AuthCard>
    );
  }

  // Direction C: the focused frame, no Sign out (no session on this page).
  return (
    <AuthShell
      variant="focus"
      brand={brand}
      texts={shell}
      // The language switch keeps an unused link working: the token goes along in the fragment only.
      languageSwitch={
        <AuthLanguageSwitch
          href={`${toggle.href}${mfaLinkFragment(view.kind === 'ready' ? view.token : null)}`}
          lang={toggle.lang}
          label={toggle.label}
          ariaLabel={toggle.ariaLabel}
        />
      }
    >
      <AuthHead headingRef={heading} icon={icon} iconTone={tone} size="md" title={title} />
      {body}
    </AuthShell>
  );
}
