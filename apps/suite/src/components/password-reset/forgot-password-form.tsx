'use client';
import { Alert } from '@jadarat/ui';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';
import { requestPasswordResetAction } from '../../auth/password-reset';
import { splitTaggedMessage } from '../../lib/invite-link';
import { RESEND_WAIT_SECONDS, formatCountdown } from '../../lib/password-reset-link';
import {
  AuthField,
  AuthSpinner,
  authBackLink,
  authPrimaryButton,
  authSecondaryButton,
} from '../auth/auth-field';
import { AuthIcon } from '../auth/auth-icons';
import { AuthHead } from '../auth/auth-shell';
import { type ErrorTexts, errorText } from '../auth/error-text';

/**
 * Forgot password (screen 10; FR-IAM-13, NFR-SEC-01, T-M2-08). The answer is always the same — the
 * page never learns whether the address has an account — so after sending it shows "if this address
 * is registered, a link is on its way" with the address the visitor typed, and offers to send again
 * after a minute (Auth sends one link a minute per account).
 */
export interface ForgotPasswordTexts {
  readonly emailLabel: string;
  readonly required: string;
  readonly submit: string;
  readonly submitting: string;
  readonly backToSignIn: string;
  readonly emailInvalid: string;
  readonly sentTitle: string;
  /** Raw: `{email}`. */
  readonly sentText: string;
  /** Raw: `<b>…</b>`. */
  readonly sentValidity: string;
  readonly sentSpam: string;
  readonly resend: string;
  /** Raw: `{time}`. */
  readonly resendIn: string;
  readonly resending: string;
  readonly resent: string;
}

export interface ForgotPasswordFormProps {
  readonly locale: 'ar' | 'en';
  readonly disabled: boolean;
  readonly texts: ForgotPasswordTexts;
  readonly errors: ErrorTexts;
}

function SentCard({
  locale,
  email,
  texts,
  errors,
}: {
  readonly locale: 'ar' | 'en';
  readonly email: string;
  readonly texts: ForgotPasswordTexts;
  readonly errors: ErrorTexts;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [pending, startTransition] = useTransition();
  const [waitUntil, setWaitUntil] = useState(() => Date.now() + RESEND_WAIT_SECONDS * 1000);
  const [remaining, setRemaining] = useState(RESEND_WAIT_SECONDS);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  // Focus moves to the confirmation so that screen readers announce it.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const tick = () => {
      setRemaining(Math.max(0, (waitUntil - Date.now()) / 1000));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [waitUntil]);

  const [before, after] = texts.sentText.split('{email}');
  const validity = splitTaggedMessage(texts.sentValidity, 'b');
  const waiting = remaining > 0;

  // Direction C: the confirmation replaces the page's title (which stays for screen readers), centred,
  // with the address in bold; resend shows its countdown on the button.
  return (
    <section
      className="flex flex-col items-center gap-3 text-center"
      data-testid="forgot-sent"
      data-replaces-head=""
    >
      <AuthHead
        level={2}
        headingRef={headingRef}
        icon="mailCheck"
        iconTone="success"
        size="md"
        centered
        title={texts.sentTitle}
        subtitle={
          <p>
            {before}
            <span dir="ltr" className="font-semibold text-text [unicode-bidi:isolate]">
              {email}
            </span>
            {after} {validity.before}
            <b className="font-semibold text-text">{validity.inner}</b>
            {validity.after}
          </p>
        }
      />
      <p className="m-0 text-sm text-text-muted">{texts.sentSpam}</p>
      {notice ? (
        <Alert tone={notice.tone} data-testid="forgot-resend-notice" className="w-full text-start">
          {notice.text}
        </Alert>
      ) : null}
      <div className="mt-3 flex w-full flex-col gap-4">
        <button
          type="button"
          className={authSecondaryButton}
          disabled={waiting || pending}
          data-testid="forgot-resend"
          onClick={() => {
            setNotice(null);
            startTransition(async () => {
              const result = await requestPasswordResetAction({ email, locale });
              setWaitUntil(Date.now() + RESEND_WAIT_SECONDS * 1000);
              setNotice(
                result.ok
                  ? { tone: 'success', text: texts.resent }
                  : { tone: 'danger', text: errorText(result.error, errors) },
              );
            });
          }}
        >
          {pending ? <AuthSpinner /> : <AuthIcon name="refresh" />}
          {pending
            ? texts.resending
            : waiting
              ? texts.resendIn.replace('{time}', formatCountdown(remaining))
              : texts.resend}
        </button>
        <BackToSignIn locale={locale} text={texts.backToSignIn} />
      </div>
    </section>
  );
}

/** «العودة إلى تسجيل الدخول» with the back arrow (Kawadir). */
function BackToSignIn({ locale, text }: { readonly locale: 'ar' | 'en'; readonly text: string }) {
  return (
    <a href={`/${locale}/sign-in`} className={authBackLink}>
      <AuthIcon name="back" />
      {text}
    </a>
  );
}

export function ForgotPasswordForm({ locale, disabled, texts, errors }: ForgotPasswordFormProps) {
  const [pending, startTransition] = useTransition();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);

  if (sentTo !== null) {
    return <SentCard locale={locale} email={sentTo} texts={texts} errors={errors} />;
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('email');
    const email = typeof value === 'string' ? value.trim() : '';
    setFieldError(undefined);
    setMessage(null);
    if (email === '') {
      setFieldError(texts.emailInvalid);
      return;
    }
    startTransition(async () => {
      const result = await requestPasswordResetAction({ email, locale });
      if (result.ok) {
        setSentTo(email);
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        setFieldError(texts.emailInvalid);
        return;
      }
      setMessage(errorText(result.error, errors));
    });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <AuthField
        id="forgot-email"
        name="email"
        type="email"
        icon="mail"
        label={texts.emailLabel}
        marker={texts.required}
        autoComplete="username"
        required
        maxLength={254}
        dir="ltr"
        error={fieldError}
        disabled={disabled || pending}
      />
      {message ? (
        <Alert tone="danger" data-testid="forgot-error">
          {message}
        </Alert>
      ) : null}
      <button
        type="submit"
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        className={authPrimaryButton}
      >
        {pending ? <AuthSpinner /> : <AuthIcon name="mail" className="size-5" />}
        {pending ? texts.submitting : texts.submit}
      </button>
      <BackToSignIn locale={locale} text={texts.backToSignIn} />
    </form>
  );
}
