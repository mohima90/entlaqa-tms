'use client';
import { Alert, Button, Card, buttonClasses } from '@jadarat/ui';
import { useEffect, useRef, useState, useTransition } from 'react';
import { openMfaLinkAction } from '../../auth/mfa';
import {
  type MfaLinkKind,
  type MfaLinkOutcome,
  mfaLinkFragment,
  mfaLinkTokenFromHash,
} from '../../lib/mfa-link';
import { type ErrorTexts, errorText } from '../auth/error-text';

/**
 * The authenticator set-up e-mail's links (FR-IAM-12, T-M2-10; security review H1): "confirm" makes the new
 * app count for sign-in codes and sensitive actions; "remove" ("not you?") removes it and ends every
 * sign-in session of the account. No session needed: opening the e-mailed link proves the mailbox. The
 * token is read from the URL fragment, removed from the address bar at once, kept in memory only and sent
 * in the body of the action after a click — opening the page changes nothing (mail scanners). The database
 * makes each link single use. The pages link only to fixed pages of the suite (no redirect parameter).
 */
export interface MfaLinkTexts {
  readonly pageTitle: string;
  readonly opening: string;
  readonly intro: string;
  /** Shown before the click (the "remove" link: what else happens). */
  readonly warning: string | null;
  readonly submit: string;
  readonly submitting: string;
  readonly doneTitle: string;
  readonly doneText: string;
  readonly expiredTitle: string;
  readonly expiredText: string;
  readonly invalidTitle: string;
  readonly invalidText: string;
  /** After a confirmation: on to the suite. */
  readonly continue: string;
  /** After a removal: set a new password (the forgot-password page). */
  readonly newPassword: string;
  readonly signIn: string;
}

type View =
  | { readonly kind: 'opening' }
  | { readonly kind: 'ready'; readonly token: string }
  | { readonly kind: 'done'; readonly outcome: MfaLinkOutcome };

export function MfaLinkView({
  locale,
  kind,
  productName,
  toggle,
  texts,
  errors,
}: {
  readonly locale: 'ar' | 'en';
  readonly kind: MfaLinkKind;
  readonly productName: string;
  /** The language switch: its target (locale-prefixed path without the fragment) and texts. */
  readonly toggle: {
    readonly href: string;
    readonly lang: string;
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
      const result = await openMfaLinkAction({ kind, token });
      if (result.ok) setView({ kind: 'done', outcome: result.value.outcome });
      else setMessage(errorText(result.error, errors));
    });
  }

  let title = texts.pageTitle;
  let body;
  if (view.kind === 'opening') {
    body = (
      <Card>
        <p className="m-0 text-text-muted" role="status" data-testid="mfa-link-opening">
          {texts.opening}
        </p>
      </Card>
    );
  } else if (view.kind === 'ready') {
    body = (
      <Card>
        <div className="flex flex-col gap-4">
          <p className="m-0">{texts.intro}</p>
          {texts.warning ? <Alert tone="warning">{texts.warning}</Alert> : null}
          {message ? (
            <Alert tone="danger" data-testid="mfa-link-error">
              {message}
            </Alert>
          ) : null}
          <div>
            <Button
              type="button"
              variant={kind === 'remove' ? 'danger' : 'primary'}
              disabled={pending}
              onClick={() => {
                submit(view.token);
              }}
              data-testid="mfa-link-submit"
            >
              {pending ? texts.submitting : texts.submit}
            </Button>
          </div>
        </div>
      </Card>
    );
  } else {
    const { outcome } = view;
    const done = outcome === 'confirmed' || outcome === 'removed';
    title = done
      ? texts.doneTitle
      : outcome === 'expired'
        ? texts.expiredTitle
        : texts.invalidTitle;
    const text = done
      ? texts.doneText
      : outcome === 'expired'
        ? texts.expiredText
        : texts.invalidText;
    // "Not you?": whatever the answer, a new password comes first (someone may know the current one).
    const newPassword = kind === 'remove';
    body = (
      <Card data-testid={`mfa-link-${outcome}`}>
        <div className="flex flex-col items-start gap-4">
          <Alert tone={outcome === 'confirmed' ? 'success' : 'warning'}>{text}</Alert>
          <div className="flex flex-wrap gap-2">
            {outcome === 'confirmed' ? (
              <a
                href={`/${locale}/suite`}
                className={buttonClasses({ variant: 'primary' })}
                data-testid="mfa-link-continue"
              >
                {texts.continue}
              </a>
            ) : null}
            {newPassword ? (
              <a
                href={`/${locale}/forgot-password`}
                className={buttonClasses({ variant: 'primary' })}
                data-testid="mfa-link-new-password"
              >
                {texts.newPassword}
              </a>
            ) : null}
            {outcome === 'confirmed' ? null : (
              <a
                href={`/${locale}/sign-in`}
                className={buttonClasses({ variant: newPassword ? 'secondary' : 'primary' })}
              >
                {texts.signIn}
              </a>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg font-semibold">{productName}</span>
        {/* The language switch keeps an unused link working: the token goes along in the fragment only. */}
        <a
          href={`${toggle.href}${mfaLinkFragment(view.kind === 'ready' ? view.token : null)}`}
          hrefLang={toggle.lang}
          lang={toggle.lang}
          aria-label={toggle.ariaLabel}
          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          data-testid="language-toggle"
        >
          {toggle.label}
        </a>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10">
        <h1 ref={heading} tabIndex={-1} className="m-0 text-2xl font-bold outline-none">
          {title}
        </h1>
        {body}
      </main>
    </div>
  );
}
