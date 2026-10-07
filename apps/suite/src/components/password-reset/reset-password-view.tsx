'use client';
import { Alert, Button, Card, TextField, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';
import { completePasswordResetAction } from '../../auth/password-reset';
import { splitTaggedMessage } from '../../lib/invite-link';
import {
  linkIsSpent,
  pathAfterReset,
  resetFragment,
  resetTokenFromHash,
} from '../../lib/password-reset-link';
import { passwordRuleState } from '../../lib/password-rules';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { type PasswordRuleLabels, PasswordRulesList } from '../auth/password-rules-list';
import { fieldErrorCodes } from '../profile/field-errors';

/**
 * Set a new password (screen 11; FR-IAM-13, NFR-SEC-01, T-M2-08). The e-mailed link carries the token
 * in the URL fragment (`#token_hash=…&type=recovery`): it is read here, removed from the address bar at
 * once and sent only in the body of the server action, together with the new password. Opening the page
 * verifies nothing (a link scanner cannot spend the single-use token). The token is kept in memory only.
 */
export interface ResetPasswordTexts extends PasswordRuleLabels {
  readonly pageTitle: string;
  readonly opening: string;
  readonly intro: string;
  readonly password: string;
  readonly confirmPassword: string;
  readonly showPassword: string;
  readonly required: string;
  readonly passwordTip: string;
  readonly sessionsNotice: string;
  readonly submit: string;
  readonly submitting: string;
  /** Raw: `<link>…</link>` (to the forgot-password page). */
  readonly validity: string;
  readonly tooShort: string;
  readonly tooLong: string;
  readonly mismatch: string;
  readonly invalidTitle: string;
  readonly invalidText: string;
  readonly requestNew: string;
  readonly signIn: string;
}

export interface ResetPasswordViewProps {
  readonly locale: 'ar' | 'en';
  readonly productName: string;
  /** The language switch: its target (locale-prefixed path without the fragment) and texts. */
  readonly toggle: {
    readonly href: string;
    readonly lang: string;
    readonly label: string;
    readonly ariaLabel: string;
  };
  readonly texts: ResetPasswordTexts;
  readonly errors: ErrorTexts;
}

type View =
  | { readonly kind: 'opening' }
  | { readonly kind: 'form'; readonly token: string }
  | { readonly kind: 'spent'; readonly reason: string | null };

function ResetForm({
  locale,
  token,
  texts,
  errors,
  onSpent,
}: {
  readonly locale: 'ar' | 'en';
  readonly token: string;
  readonly texts: ResetPasswordTexts;
  readonly errors: ErrorTexts;
  readonly onSpent: (reason: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const rules = passwordRuleState(password, confirmation);
  const validity = splitTaggedMessage(texts.validity, 'link');

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});
    // The rules are checked here and again by the action BEFORE the single-use link is spent.
    if (!(rules.minLength && rules.maxBytes)) {
      setFieldErrors({ password: rules.minLength ? texts.tooLong : texts.tooShort });
      return;
    }
    if (!rules.matches) {
      setFieldErrors({ confirmPassword: texts.mismatch });
      return;
    }
    startTransition(async () => {
      const result = await completePasswordResetAction({
        tokenHash: token,
        password,
        confirmPassword: confirmation,
      });
      if (result.ok) {
        router.replace(pathAfterReset(locale));
        router.refresh();
        return;
      }
      if (linkIsSpent(result.error.code)) {
        onSpent(errorText(result.error, errors));
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const codes = fieldErrorCodes(result.error);
        setFieldErrors({
          ...(codes.password
            ? { password: codes.password === 'TOO_SMALL' ? texts.tooShort : texts.tooLong }
            : {}),
          ...(codes.confirmPassword ? { confirmPassword: texts.mismatch } : {}),
        });
      }
      setMessage(errorText(result.error, errors));
    });
  }

  return (
    <>
      <p className="m-0 text-text-muted">{texts.intro}</p>
      <Card>
        <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
          <div className="flex flex-col gap-2">
            <TextField
              id="reset-password"
              name="password"
              type={reveal ? 'text' : 'password'}
              label={texts.password}
              marker={texts.required}
              autoComplete="new-password"
              required
              minLength={12}
              dir="ltr"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              aria-describedby="reset-password-rules"
              error={fieldErrors.password}
              disabled={pending}
            />
            <PasswordRulesList id="reset-password-rules" rules={rules} labels={texts} />
            <p className="m-0 text-sm text-text-muted">{texts.passwordTip}</p>
          </div>
          <TextField
            id="reset-password-confirm"
            name="confirmPassword"
            type={reveal ? 'text' : 'password'}
            label={texts.confirmPassword}
            marker={texts.required}
            autoComplete="new-password"
            required
            dir="ltr"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
            error={fieldErrors.confirmPassword}
            disabled={pending}
          />
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={reveal}
              onChange={(event) => {
                setReveal(event.target.checked);
              }}
              className="size-5 shrink-0"
            />
            {texts.showPassword}
          </label>
          <Alert tone="info">{texts.sessionsNotice}</Alert>
          {message ? (
            <Alert tone="danger" data-testid="reset-error">
              {message}
            </Alert>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? texts.submitting : texts.submit}
          </Button>
        </form>
      </Card>
      <p className="m-0 text-center text-sm text-text-muted">
        {validity.before}
        <a href={`/${locale}/forgot-password`} className="underline">
          {validity.inner}
        </a>
        {validity.after}
      </p>
    </>
  );
}

/**
 * The page body. On load: read the token from the URL fragment and remove the fragment from the
 * address bar (history.replaceState: not in the history, not in a bookmark). Without a usable token the
 * "request a new link" state shows at once.
 */
export function ResetPasswordView({
  locale,
  productName,
  toggle,
  texts,
  errors,
}: ResetPasswordViewProps) {
  const [view, setView] = useState<View>({ kind: 'opening' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { hash, pathname, search } = window.location;
    const token = resetTokenFromHash(hash);
    if (hash !== '') {
      window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    }
    setView(token ? { kind: 'form', token } : { kind: 'spent', reason: null });
  }, []);

  let title = texts.pageTitle;
  let body;
  if (view.kind === 'opening') {
    body = (
      <Card>
        <p className="m-0 text-text-muted" role="status" data-testid="reset-opening">
          {texts.opening}
        </p>
      </Card>
    );
  } else if (view.kind === 'form') {
    body = (
      <ResetForm
        locale={locale}
        token={view.token}
        texts={texts}
        errors={errors}
        onSpent={(reason) => {
          setView({ kind: 'spent', reason });
        }}
      />
    );
  } else {
    title = texts.invalidTitle;
    body = (
      <Card data-testid="reset-link-invalid">
        <div className="flex flex-col items-start gap-3">
          <span
            className="inline-flex size-12 items-center justify-center rounded-full bg-warning-subtle"
            aria-hidden="true"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          {view.reason ? (
            <Alert tone="danger" data-testid="reset-error">
              {view.reason}
            </Alert>
          ) : (
            <p className="m-0">{texts.invalidText}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={`/${locale}/forgot-password`}
              className={buttonClasses({ variant: 'primary' })}
            >
              {texts.requestNew}
            </a>
            <a href={`/${locale}/sign-in`} className={buttonClasses({ variant: 'secondary' })}>
              {texts.signIn}
            </a>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg font-semibold">{productName}</span>
        {/* The language switch keeps the link working: the token goes along in the fragment only. */}
        <a
          href={`${toggle.href}${resetFragment(view.kind === 'form' ? view.token : null)}`}
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
        <h1 className="m-0 text-2xl font-bold">{title}</h1>
        {body}
      </main>
    </div>
  );
}
