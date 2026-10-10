'use client';
import { Alert, Button, TextField, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import {
  confirmMfaSetupAction,
  dismissMfaPromptAction,
  removeMfaAppAction,
  resendMfaSetupMailAction,
  startTotpSetupAction,
  verifyTotpCodeAction,
} from '../../auth/mfa';
import { looksLikeEmailSetupCode, looksLikeTotpCode } from '../../lib/totp-code';
import { type ErrorTexts, errorText } from '../auth/error-text';

/**
 * The authenticator-app steps of the /mfa page (FR-IAM-12, T-M2-10; screen 8 step 2): a code from the
 * account's app (sign-in or before a sensitive action), setting an app up (QR code, or the key typed in,
 * then the first code), and — once set up — the one-time code e-mailed to the owner, entered in THIS window
 * (security re-review N1: the app counts only then). Every other sign-in of the account is told "an app was
 * added from another sign-in" and can remove it. Everything goes through the public MFA actions; the secret
 * is shown to its owner only, never stored in the browser.
 */
export interface MfaTexts {
  readonly codeLabel: string;
  readonly codeHint: string;
  readonly verify: string;
  readonly verifying: string;
  readonly start: string;
  readonly starting: string;
  readonly scanStep: string;
  readonly qrAlt: string;
  readonly keyStep: string;
  readonly keyLabel: string;
  readonly codeStep: string;
  readonly finish: string;
  readonly notNow: string;
  /** "Not now" is asked again after 30 days (PO answer, 9 Oct 2026). */
  readonly notNowHint: string;
  readonly continueWithout: string;
  readonly appsHint: string;
  readonly codeFormat: string;
}

/** This window's app waiting for the e-mailed code (re-review N1). */
export interface MfaPendingTexts {
  readonly delay: string;
  readonly codeLabel: string;
  readonly codeHint: string;
  readonly codeFormat: string;
  readonly confirm: string;
  readonly confirming: string;
  readonly notMe: string;
  readonly resend: string;
  readonly resending: string;
  readonly resent: string;
  readonly resentWaiting: string;
  readonly cancel: string;
  readonly cancelling: string;
  readonly continueWithout: string;
}

/** An app added from another sign-in (re-review N1). */
export interface MfaElsewhereTexts {
  readonly notMeHint: string;
  readonly remove: string;
  readonly removing: string;
  readonly removed: string;
  readonly newPassword: string;
  /** After the removal: the page shows what comes next (a new set-up, or the suite). */
  readonly continue: string;
  readonly itWasMe: string;
  readonly itWasMeText: string;
  readonly itWasMeClosed: string;
  readonly continueWithout: string;
}

function useContinue(next: string) {
  const router = useRouter();
  return () => {
    router.replace(next);
    router.refresh();
  };
}

interface CodeField {
  readonly label: string;
  readonly hint: string;
  readonly formatError: string;
  readonly looksValid: (value: string) => boolean;
  /** data-testid of the input and the button. */
  readonly testId: string;
}

function CodeForm({
  id,
  field,
  errors,
  submitLabel,
  pendingLabel,
  onSubmit,
}: {
  readonly id: string;
  readonly field: CodeField;
  readonly errors: ErrorTexts;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly onSubmit: (
    code: string,
  ) => Promise<{ ok: true } | { ok: false; error: Parameters<typeof errorText>[0] }>;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('code');
    const code = typeof value === 'string' ? value : '';
    setMessage(null);
    setFieldError(undefined);
    if (!field.looksValid(code)) {
      setFieldError(field.formatError);
      return;
    }
    startTransition(async () => {
      const result = await onSubmit(code);
      if (!result.ok) setMessage(errorText(result.error, errors));
    });
  }

  return (
    <form className="flex max-w-sm flex-col gap-4" onSubmit={submit} noValidate>
      <TextField
        id={id}
        name="code"
        label={field.label}
        hint={field.hint}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={16}
        required
        dir="ltr"
        error={fieldError}
        disabled={pending}
        data-testid={field.testId}
      />
      {message ? (
        <Alert tone="danger" data-testid="mfa-error">
          {message}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" disabled={pending} data-testid={`${field.testId}-submit`}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

const appCodeField = (texts: MfaTexts): CodeField => ({
  label: texts.codeLabel,
  hint: texts.codeHint,
  formatError: texts.codeFormat,
  looksValid: looksLikeTotpCode,
  testId: 'mfa-code',
});

/** A code from the account's app (sign-in, or before a sensitive action). */
export function MfaChallenge({
  next,
  texts,
  errors,
}: {
  readonly next: string;
  readonly texts: MfaTexts;
  readonly errors: ErrorTexts;
}) {
  const proceed = useContinue(next);
  return (
    <CodeForm
      id="mfa-challenge-code"
      field={appCodeField(texts)}
      errors={errors}
      submitLabel={texts.verify}
      pendingLabel={texts.verifying}
      onSubmit={async (code) => {
        const result = await verifyTotpCodeAction({ code });
        if (result.ok) proceed();
        return result.ok ? { ok: true } : result;
      }}
    />
  );
}

interface Setup {
  readonly factorId: string;
  readonly qrCode: string;
  readonly secret: string;
}

/** The secret in groups of four, for typing it into an app. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Setting up an app: start → QR code and key → first code → the e-mailed code (the page asks for it).
 * `skip`: the prompts let the member continue without it (the Organization Admin's
 * "not now" is asked again after 30 days, PO decision 2 and answer of 9 Oct 2026).
 */
export function MfaSetup({
  next,
  skip,
  texts,
  errors,
}: {
  readonly next: string;
  readonly skip: 'admin' | 'grace' | null;
  readonly texts: MfaTexts;
  readonly errors: ErrorTexts;
}) {
  const router = useRouter();
  const proceed = useContinue(next);
  const [pending, startTransition] = useTransition();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function start() {
    setMessage(null);
    startTransition(async () => {
      const result = await startTotpSetupAction({});
      if (result.ok) setSetup(result.value);
      else setMessage(errorText(result.error, errors));
    });
  }

  function later() {
    startTransition(async () => {
      if (skip === 'admin') await dismissMfaPromptAction({});
      proceed();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {setup === null ? (
        <>
          <p className="m-0 text-text-muted">{texts.appsHint}</p>
          {message ? (
            <Alert tone="danger" data-testid="mfa-error">
              {message}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={start} disabled={pending} data-testid="mfa-start">
              {pending ? texts.starting : texts.start}
            </Button>
            {skip ? (
              <Button
                type="button"
                variant="secondary"
                onClick={later}
                disabled={pending}
                data-testid="mfa-skip"
              >
                {skip === 'admin' ? texts.notNow : texts.continueWithout}
              </Button>
            ) : null}
          </div>
          {skip === 'admin' ? (
            <p className="m-0 text-sm text-text-muted">{texts.notNowHint}</p>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <p className="m-0 font-medium">{texts.scanStep}</p>
            {/* Auth's QR code (an SVG data URL; CSP img-src allows data:). */}
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, not an optimisable image */}
            <img
              src={setup.qrCode}
              alt={texts.qrAlt}
              width={200}
              height={200}
              className="rounded-md border border-border bg-white p-2"
              data-testid="mfa-qr"
            />
            <p className="m-0 text-sm text-text-muted">{texts.keyStep}</p>
            <p className="m-0">
              <span className="sr-only">{texts.keyLabel}: </span>
              <code
                dir="ltr"
                className="inline-block select-all rounded-md bg-surface-hover px-3 py-2 font-mono text-base tracking-wider"
                data-testid="mfa-secret"
              >
                {grouped(setup.secret)}
              </code>
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <p className="m-0 font-medium">{texts.codeStep}</p>
            <CodeForm
              id="mfa-setup-code"
              field={appCodeField(texts)}
              errors={errors}
              submitLabel={texts.finish}
              pendingLabel={texts.verifying}
              onSubmit={async (code) => {
                const result = await verifyTotpCodeAction({ code, factorId: setup.factorId });
                // Set up: the app waits for the e-mailed code — this page then asks for it.
                if (result.ok) router.refresh();
                else if (result.error.code === 'MFA_SETUP_EXPIRED') setSetup(null);
                return result.ok ? { ok: true } : result;
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * THIS window set the app up and it waits for the one-time code e-mailed to the owner (security re-review N1,
 * TM-0003 T-IAM-11): entered here, it makes the app count (the database accepts it only from this window's
 * session). A worker that sends late delays only this step: "send the e-mail again" asks for a new code (the
 * newest replaces the earlier ones); "cancel the set-up" removes the app. `mayContinue`: a prompt (not a
 * requirement) lets the member go on without it.
 */
export function MfaPending({
  factorId,
  next,
  mayContinue,
  texts,
  errors,
}: {
  readonly factorId: string;
  readonly next: string;
  readonly mayContinue: boolean;
  readonly texts: MfaPendingTexts;
  readonly errors: ErrorTexts;
}) {
  const router = useRouter();
  const proceed = useContinue(next);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<'resend' | 'cancel' | null>(null);
  const [message, setMessage] = useState<{
    tone: 'success' | 'info' | 'danger';
    text: string;
  } | null>(null);

  function resend() {
    setMessage(null);
    setRunning('resend');
    startTransition(async () => {
      const result = await resendMfaSetupMailAction({});
      setMessage(
        result.ok
          ? {
              tone: result.value.sent ? 'success' : 'info',
              text: result.value.sent ? texts.resent : texts.resentWaiting,
            }
          : { tone: 'danger', text: errorText(result.error, errors) },
      );
    });
  }

  function cancel() {
    setMessage(null);
    setRunning('cancel');
    startTransition(async () => {
      const result = await removeMfaAppAction({ factorId });
      if (result.ok) router.refresh();
      else setMessage({ tone: 'danger', text: errorText(result.error, errors) });
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="mfa-pending-steps">
      <p className="m-0">{texts.delay}</p>
      <CodeForm
        id="mfa-email-code"
        field={{
          label: texts.codeLabel,
          hint: texts.codeHint,
          formatError: texts.codeFormat,
          looksValid: looksLikeEmailSetupCode,
          testId: 'mfa-email-code',
        }}
        errors={errors}
        submitLabel={texts.confirm}
        pendingLabel={texts.confirming}
        onSubmit={async (code) => {
          const result = await confirmMfaSetupAction({ code });
          if (result.ok) proceed();
          return result.ok ? { ok: true } : result;
        }}
      />
      <p className="m-0 text-sm text-text-muted">{texts.notMe}</p>
      {message ? (
        <Alert tone={message.tone} data-testid="mfa-pending-message">
          {message.text}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={resend}
          disabled={pending}
          data-testid="mfa-pending-resend"
        >
          {pending && running === 'resend' ? texts.resending : texts.resend}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={cancel}
          disabled={pending}
          data-testid="mfa-pending-cancel"
        >
          {pending && running === 'cancel' ? texts.cancelling : texts.cancel}
        </Button>
        {mayContinue ? (
          <Button
            type="button"
            variant="ghost"
            onClick={proceed}
            disabled={pending}
            data-testid="mfa-skip"
          >
            {texts.continueWithout}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * An app was added from ANOTHER sign-in of the account and nobody entered its code yet (security re-review
 * N1): this window cannot confirm it. The main action removes it — every OTHER session of the account ends,
 * whoever set it up included; then a new password. "It was me" explains where to finish (and lets the member
 * go on when nothing requires an app).
 */
export function MfaElsewhere({
  locale,
  factorId,
  next,
  mayContinue,
  texts,
  errors,
}: {
  readonly locale: string;
  readonly factorId: string;
  readonly next: string;
  readonly mayContinue: boolean;
  readonly texts: MfaElsewhereTexts;
  readonly errors: ErrorTexts;
}) {
  const router = useRouter();
  const proceed = useContinue(next);
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState(false);
  const [itWasMe, setItWasMe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function remove() {
    setMessage(null);
    startTransition(async () => {
      const result = await removeMfaAppAction({ factorId });
      if (result.ok) setRemoved(true);
      else setMessage(errorText(result.error, errors));
    });
  }

  if (removed) {
    return (
      <div className="flex flex-col items-start gap-4" data-testid="mfa-elsewhere-removed">
        <Alert tone="success">{texts.removed}</Alert>
        <div className="flex flex-wrap gap-3">
          <a
            href={`/${locale}/forgot-password`}
            className={buttonClasses({ variant: 'primary' })}
            data-testid="mfa-elsewhere-new-password"
          >
            {texts.newPassword}
          </a>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              router.refresh();
            }}
            data-testid="mfa-elsewhere-continue"
          >
            {texts.continue}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="mfa-elsewhere-steps">
      <p className="m-0">{texts.notMeHint}</p>
      {message ? (
        <Alert tone="danger" data-testid="mfa-error">
          {message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="danger"
          onClick={remove}
          disabled={pending}
          data-testid="mfa-elsewhere-remove"
        >
          {pending ? texts.removing : texts.remove}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setItWasMe(true);
          }}
          disabled={pending}
          aria-expanded={itWasMe}
          aria-controls="mfa-elsewhere-it-was-me"
          data-testid="mfa-elsewhere-it-was-me"
        >
          {texts.itWasMe}
        </Button>
      </div>
      {itWasMe ? (
        <div
          id="mfa-elsewhere-it-was-me"
          className="flex flex-col items-start gap-3"
          data-testid="mfa-elsewhere-it-was-me-text"
        >
          <Alert tone="info">{texts.itWasMeText}</Alert>
          <p className="m-0 text-sm text-text-muted">{texts.itWasMeClosed}</p>
          {mayContinue ? (
            <Button
              type="button"
              variant="ghost"
              onClick={proceed}
              disabled={pending}
              data-testid="mfa-skip"
            >
              {texts.continueWithout}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
