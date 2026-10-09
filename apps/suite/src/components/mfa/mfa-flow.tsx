'use client';
import { Alert, Button, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { dismissMfaPromptAction, startTotpSetupAction, verifyTotpCodeAction } from '../../auth/mfa';
import { type ErrorTexts, errorText } from '../auth/error-text';

/**
 * The authenticator-app steps of the /mfa page (FR-IAM-12, T-M2-10; screen 8 step 2): a code from the
 * account's app (sign-in or before a sensitive action), or setting an app up (QR code, or the key typed
 * in, then the first code). Everything goes through the public MFA actions; the secret is shown to its
 * owner only, never stored in the browser.
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
  readonly continueWithout: string;
  readonly appsHint: string;
  readonly codeFormat: string;
}

function useContinue(next: string) {
  const router = useRouter();
  return () => {
    router.replace(next);
    router.refresh();
  };
}

/** Six digits (any script) — checked again on the server. */
function looksLikeCode(value: string): boolean {
  return /^[0-9٠-٩۰-۹]{6}$/.test(value.replace(/\s/g, ''));
}

function CodeForm({
  id,
  texts,
  errors,
  submitLabel,
  onSubmit,
}: {
  readonly id: string;
  readonly texts: MfaTexts;
  readonly errors: ErrorTexts;
  readonly submitLabel: string;
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
    if (!looksLikeCode(code)) {
      setFieldError(texts.codeFormat);
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
        label={texts.codeLabel}
        hint={texts.codeHint}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={12}
        required
        dir="ltr"
        error={fieldError}
        disabled={pending}
        data-testid="mfa-code"
      />
      {message ? (
        <Alert tone="danger" data-testid="mfa-error">
          {message}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" disabled={pending} data-testid="mfa-verify">
          {pending ? texts.verifying : submitLabel}
        </Button>
      </div>
    </form>
  );
}

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
      texts={texts}
      errors={errors}
      submitLabel={texts.verify}
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
 * Setting up an app: start → QR code and key → first code → done. `skip`: the prompts let the member
 * continue without it (the Organization Admin's "not now" is remembered, PO decision 2).
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
              texts={texts}
              errors={errors}
              submitLabel={texts.finish}
              onSubmit={async (code) => {
                const result = await verifyTotpCodeAction({ code, factorId: setup.factorId });
                if (result.ok) proceed();
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
