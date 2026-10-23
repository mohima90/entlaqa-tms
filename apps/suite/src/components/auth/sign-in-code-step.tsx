'use client';
import { Alert } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';
import {
  completeRememberedSignInAction,
  requestSignInCodeAction,
  signInWithCodeAction,
} from '../../auth/actions';
import { CODE_LENGTH, formatCountdown, triesLeftText } from '../../lib/sign-in-code-ui';
import { signInDestination } from '../../lib/sign-in-steps';
import { AuthSpinner, authPrimaryButton } from './auth-field';
import { AuthIcon } from './auth-icons';
import { CodeBoxes, type CodeBoxesHandle } from './code-boxes';
import { type ErrorTexts, errorText } from './error-text';

/**
 * «Email me a code» (WP-ADM-05, PO 23 Oct 2026): the screen after the code was asked for, and the screen of a
 * remembered browser. Same for every address - it never says whether the account exists. The code is typed in six
 * boxes (one-time-code autofill, paste, a label per box); the check happens when the button is pressed and the
 * message goes ON the field (never a disabled button); after the server's answer focus returns to the boxes. A new
 * code can be asked for once a minute (the countdown is announced once, when it ends, not every second). Five
 * wrong codes kill the code and pause code checks for 15 minutes: the screen then offers the password instead.
 */
export interface SignInCodeLabels {
  readonly intro: string;
  readonly label: string;
  readonly digit: string;
  readonly spam: string;
  readonly remember: string;
  readonly rememberHint: string;
  readonly submit: string;
  readonly submitting: string;
  readonly resendIn: string;
  readonly resend: string;
  readonly resendLead: string;
  readonly resending: string;
  readonly resent: string;
  readonly resendReady: string;
  readonly errFormat: string;
  readonly triesLeft: Readonly<Record<string, string>>;
  readonly lockedHelp: string;
  readonly usePassword: string;
  readonly rememberedTitle: string;
  readonly rememberedText: string;
  readonly rememberedFailed: string;
}

const WRONG = 'SIGN_IN_CODE_INVALID';
const EXPIRED = 'SIGN_IN_CODE_EXPIRED';
const LOCKED = 'SIGN_IN_CODE_LOCKED';
const TOO_SOON = 'SIGN_IN_CODE_TOO_SOON';

export interface SignInCodeStepProps {
  readonly locale: string;
  readonly email: string;
  readonly requestId: string;
  /** Seconds until a new code may be asked for (60 after sending). */
  readonly resendSeconds: number;
  readonly labels: SignInCodeLabels;
  readonly errors: ErrorTexts;
  /** A new code was sent: the form keeps the new request. */
  readonly onNewRequest: (requestId: string) => void;
  readonly onUsePassword: () => void;
  /** A line shown at first (a remembered sign-in that fell back to a code). */
  readonly notice?: string | undefined;
}

export function SignInCodeStep({
  locale,
  email,
  requestId,
  resendSeconds,
  labels,
  errors,
  onNewRequest,
  onUsePassword,
  notice,
}: SignInCodeStepProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resending, startResend] = useTransition();
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(notice ?? null);
  const [locked, setLocked] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(resendSeconds);
  const boxes = useRef<CodeBoxesHandle>(null);
  // The boxes are disabled while the code is checked, so focus returns to them once the answer is shown.
  const focusBoxes = useRef(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [secondsLeft]);

  useEffect(() => {
    if (pending || resending || !focusBoxes.current) return;
    focusBoxes.current = false;
    boxes.current?.focus();
  }, [pending, resending, fieldError, status]);

  useEffect(() => {
    boxes.current?.focus();
  }, []);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setBanner(null);
    setStatus(null);
    setFieldError(undefined);
    if (code.length < CODE_LENGTH) {
      setFieldError(labels.errFormat);
      boxes.current?.focus();
      return;
    }
    focusBoxes.current = true;
    startTransition(async () => {
      const result = await signInWithCodeAction({ requestId, email, code, remember });
      if (result.ok) {
        router.replace(signInDestination(locale, result.value.next));
        router.refresh();
        return;
      }
      const error = result.error;
      if (error.code === WRONG) {
        const tries = Number(error.params?.tries ?? 0);
        setFieldError(
          `${errorText(error, errors)} ${triesLeftText(locale, tries, labels.triesLeft)}.`,
        );
        setCode('');
      } else if (error.code === EXPIRED) {
        setFieldError(errorText(error, errors));
        setCode('');
      } else if (error.code === LOCKED) {
        setLocked(true);
        setCode('');
        setBanner(errorText(error, errors));
        focusBoxes.current = false;
      } else {
        setBanner(errorText(error, errors));
      }
    });
  }

  function resend() {
    setBanner(null);
    setFieldError(undefined);
    setStatus(null);
    focusBoxes.current = true;
    startResend(async () => {
      const result = await requestSignInCodeAction({ email, forceCode: true });
      if (result.ok && result.value.kind === 'code') {
        onNewRequest(result.value.requestId);
        setCode('');
        setLocked(false);
        setSecondsLeft(result.value.resendAfterSeconds);
        setStatus(labels.resent);
      } else if (!result.ok && result.error.code === TOO_SOON) {
        setSecondsLeft(Number(result.error.params?.seconds ?? 60));
        setBanner(errorText(result.error, errors));
      } else if (!result.ok) {
        setBanner(errorText(result.error, errors));
      }
    });
  }

  const busy = pending || resending;
  const errorId = fieldError ? 'sign-in-code-error' : undefined;
  const describedBy = [errorId, 'sign-in-code-hint'].filter(Boolean).join(' ');
  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate data-testid="sign-in-code-form">
      <p className="m-0 text-text-muted" data-testid="sign-in-code-intro">
        {labels.intro.replace('{email}', email)}
      </p>
      <div className="flex flex-col gap-2.5">
        <span id="sign-in-code-label" className="text-center text-sm font-semibold text-text">
          {labels.label}
        </span>
        <CodeBoxes
          ref={boxes}
          id="sign-in-code"
          value={code}
          onChange={(next) => {
            setCode(next);
            if (fieldError) setFieldError(undefined);
          }}
          boxLabel={(n, total) => labels.digit.replace('{n}', String(n)).replace('{total}', String(total))}
          legend={labels.label}
          disabled={busy || locked}
          invalid={fieldError !== undefined}
          describedBy={describedBy}
        />
        {fieldError ? (
          <p
            id="sign-in-code-error"
            role="alert"
            className="m-0 flex items-start justify-center gap-2 text-center text-[13.5px] font-semibold text-danger"
            data-testid="sign-in-code-error"
          >
            <AuthIcon name="alert" className="mt-px size-4 shrink-0" />
            <span>{fieldError}</span>
          </p>
        ) : null}
        <p id="sign-in-code-hint" className="m-0 text-center text-[13.5px] text-text-muted">
          {labels.spam}
        </p>
      </div>
      <div className="flex items-start gap-3">
        <input
          id="sign-in-code-remember"
          type="checkbox"
          aria-describedby="sign-in-code-remember-hint"
          checked={remember}
          onChange={(event) => {
            setRemember(event.target.checked);
          }}
          disabled={busy}
          className="mt-0.5 size-5.5 shrink-0 accent-[var(--color-primary)]"
          data-testid="sign-in-code-remember"
        />
        <div className="flex flex-col gap-0.5">
          <label htmlFor="sign-in-code-remember" className="font-medium">
            {labels.remember}
          </label>
          <p id="sign-in-code-remember-hint" className="m-0 text-[13.5px] text-text-muted">
            {labels.rememberHint}
          </p>
        </div>
      </div>
      {banner ? (
        <Alert tone={locked ? 'warning' : 'danger'} role="alert" data-testid="sign-in-code-banner">
          {banner}
          {locked ? <> {labels.lockedHelp}</> : null}
        </Alert>
      ) : null}
      {status ? (
        <p role="status" className="m-0 text-center text-[13.5px] font-semibold text-success" data-testid="sign-in-code-resent">
          {status}
        </p>
      ) : null}
      <button
        type="submit"
        className={authPrimaryButton}
        disabled={busy || locked}
        aria-busy={pending || undefined}
        data-testid="sign-in-code-submit"
      >
        {pending ? <AuthSpinner /> : null}
        {pending ? labels.submitting : labels.submit}
        {pending ? null : <AuthIcon name="arrow" />}
      </button>
      {!locked ? (
        <div className="flex flex-col items-center gap-1 text-center text-sm text-text-muted">
          {secondsLeft > 0 ? (
            // A timer, not read every second: its end is announced once by the status line below.
            <p className="m-0" role="timer" aria-live="off" data-testid="sign-in-code-countdown">
              {labels.resendIn.replace('{time}', formatCountdown(secondsLeft))}
            </p>
          ) : (
            <p className="m-0 flex flex-wrap items-center justify-center gap-x-2">
              <span>{labels.resendLead}</span>
              <button
                type="button"
                onClick={resend}
                disabled={busy}
                className="min-h-11 rounded-full px-3.5 font-semibold text-primary-text hover:bg-primary-subtle disabled:opacity-70"
                data-testid="sign-in-code-resend"
              >
                {resending ? labels.resending : labels.resend}
              </button>
            </p>
          )}
          <span className="sr-only" role="status">
            {secondsLeft === 0 ? labels.resendReady : ''}
          </span>
        </div>
      ) : null}
      <button
        type="button"
        onClick={onUsePassword}
        disabled={busy}
        className="min-h-11 self-center rounded-full px-3.5 font-semibold text-primary-text hover:bg-primary-subtle"
        data-testid="sign-in-code-use-password"
      >
        {labels.usePassword}
      </button>
    </form>
  );
}

export interface RememberedSignInProps {
  readonly locale: string;
  readonly email: string;
  readonly requestId: string;
  readonly labels: SignInCodeLabels;
  readonly errors: ErrorTexts;
  /** The remembered sign-in could not finish: a code was sent instead (or the refusal text). */
  readonly onFallback: (
    result: { readonly requestId: string } | { readonly message: string },
  ) => void;
}

/**
 * A remembered browser signs in without a code: the worker is minting the one-time token (no e-mail), so the page
 * asks a few times (each ask waits several seconds on the server) and then opens the suite. When it cannot - the
 * browser was forgotten, the organization shortened the period, the worker is slow - a code is sent instead.
 */
export function RememberedSignIn({
  locale,
  email,
  requestId,
  labels,
  errors,
  onFallback,
}: RememberedSignInProps) {
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await completeRememberedSignInAction({ requestId, email });
        if (!result.ok) break;
        if (result.value.status === 'done') {
          router.replace(signInDestination(locale, result.value.outcome.next));
          router.refresh();
          return;
        }
      }
      const sent = await requestSignInCodeAction({ email, forceCode: true });
      if (sent.ok && sent.value.kind === 'code') onFallback({ requestId: sent.value.requestId });
      else onFallback({ message: sent.ok ? labels.rememberedFailed : errorText(sent.error, errors) });
    })();
  }, [requestId, email, locale, router, onFallback, labels.rememberedFailed, errors]);
  return (
    <div
      className="flex flex-col items-center gap-3 py-6 text-center"
      role="status"
      data-testid="sign-in-remembered"
    >
      <AuthSpinner />
      <p className="m-0 text-lg font-semibold">{labels.rememberedTitle}</p>
      <p className="m-0 text-text-muted">{labels.rememberedText}</p>
    </div>
  );
}
