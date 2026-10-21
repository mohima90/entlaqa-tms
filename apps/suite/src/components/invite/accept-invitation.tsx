'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { signOutAction } from '../../auth/actions';
import {
  acceptInvitationAction,
  acceptInvitationAsSignedInUser,
  acceptInvitationWithSignInAction,
} from '../../auth/invitations';
import { inviteCodeFromHash, signUpFragment } from '../../lib/invite-link';
import { minFromParams, passwordRuleState, withMin } from '../../lib/password-rules';
import {
  AuthField,
  AuthSpinner,
  RevealButton,
  authPrimaryButton,
  authSecondaryButton,
} from '../auth/auth-field';
import { AuthIcon } from '../auth/auth-icons';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { PasswordRulesList } from '../auth/password-rules-list';
import { fieldErrorCodes } from '../profile/field-errors';

/**
 * Invitee side of an invitation (screens 8 and 9; FR-IAM-03, T-M2-07): the forms of the sign-up page
 * (components/invite/sign-up-view.tsx, Kawadir's "join" screen) — create the account, sign in to accept,
 * accept as the signed-in invitee, sign out of another account — and the forwarder of the older
 * `/invite/accept#token=…` links. The code travels only in the body of the server actions — never in a URL
 * the server sees, never logged or stored in the browser (review M3).
 */

type Next = 'home' | 'choose-organization' | 'sign-in' | 'mfa';

function nextPath(locale: string, next: Next): string {
  if (next === 'home') return `/${locale}/suite`;
  // The organization asks for an authenticator app (screen 8, step 2; T-M2-10).
  if (next === 'mfa') return `/${locale}/mfa`;
  return `/${locale}/${next === 'choose-organization' ? 'select-organization' : 'sign-in'}`;
}

/**
 * Shared handling: go on after success; when the invitation changed meanwhile, look the link up again
 * (`onInvalidated`), which then shows its state (screen 9).
 */
function useInviteOutcome(locale: string, onInvalidated: () => void) {
  const router = useRouter();
  return {
    done(next: Next) {
      router.replace(nextPath(locale, next));
      router.refresh();
    },
    invalidated(error: AppError): boolean {
      if (error.code !== 'INVITATION_NOT_VALID') return false;
      onInvalidated();
      return true;
    },
  };
}

export interface AcceptInvitationFormProps {
  readonly locale: string;
  readonly token: string;
  readonly email: string;
  readonly displayName: { readonly ar: string; readonly en: string };
  /** The invited organization's minimum password length (T-M2-10; at least 12). */
  readonly passwordMinLength: number;
  /** The privacy acknowledgement sentence with its link (rendered on the server). */
  readonly privacyLabel: ReactNode;
  readonly labels: {
    readonly loginEmail: string;
    readonly loginEmailHint: string;
    readonly displayNameAr: string;
    readonly displayNameEn: string;
    readonly displayNameHint: string;
    readonly optional: string;
    readonly required: string;
    readonly password: string;
    readonly confirmPassword: string;
    readonly showPassword: string;
    readonly hidePassword: string;
    readonly rulesLabel: string;
    readonly ruleMinLength: string;
    readonly ruleMaxBytes: string;
    readonly ruleMatches: string;
    readonly ruleMet: string;
    readonly ruleNotMet: string;
    readonly passwordTip: string;
    /** «انضم إلى {organization}» (filled in). */
    readonly submit: string;
    readonly submitting: string;
    readonly signInTitle: string;
    readonly signInIntro: string;
    readonly signInSubmit: string;
    readonly signInSubmitting: string;
  };
  readonly fieldTexts: {
    readonly tooShort: string;
    readonly tooLong: string;
    readonly mismatch: string;
    readonly nameTooLong: string;
    readonly nameInvisible: string;
    readonly privacyRequired: string;
    readonly passwordRequired: string;
  };
  readonly errors: ErrorTexts;
  /** The invitation changed meanwhile: look the link up again. */
  readonly onInvalidated: () => void;
}

/** The text for a refused display name: too long, or without visible letters. */
function nameError(
  code: string | undefined,
  fieldTexts: AcceptInvitationFormProps['fieldTexts'],
): string | undefined {
  if (code === undefined) return undefined;
  return code === 'TOO_BIG' ? fieldTexts.nameTooLong : fieldTexts.nameInvisible;
}

/** Screen 8: set a password (new account), or — when the e-mail already has one — sign in to accept. */
export function AcceptInvitationForm(props: AcceptInvitationFormProps) {
  const [mode, setMode] = useState<'create' | 'sign-in'>('create');
  return mode === 'create' ? (
    <CreateAccountForm
      {...props}
      onAccountExists={() => {
        setMode('sign-in');
      }}
    />
  ) : (
    <SignInToAcceptForm {...props} />
  );
}

function CreateAccountForm({
  locale,
  token,
  email,
  displayName,
  passwordMinLength,
  privacyLabel,
  labels,
  fieldTexts,
  errors,
  onInvalidated,
  onAccountExists,
}: AcceptInvitationFormProps & { readonly onAccountExists: () => void }) {
  const outcome = useInviteOutcome(locale, onInvalidated);
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const rules = passwordRuleState(password, confirmation, passwordMinLength);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    setMessage(null);
    setFieldErrors({});
    // The acknowledgement is required (the server schema accepts only `true`).
    if (form.get('privacyAcknowledged') !== 'on') {
      setFieldErrors({ privacyAcknowledged: fieldTexts.privacyRequired });
      return;
    }
    const input = {
      token,
      displayNameAr: field('displayNameAr'),
      displayNameEn: field('displayNameEn'),
      password,
      confirmPassword: confirmation,
      privacyAcknowledged: true as const,
    };
    startTransition(async () => {
      const result = await acceptInvitationAction(input);
      if (result.ok) {
        outcome.done(result.value.next);
        return;
      }
      if (outcome.invalidated(result.error)) return;
      if (result.error.code === 'INVITATION_ACCOUNT_EXISTS') {
        onAccountExists();
        return;
      }
      if (result.error.code === 'INVITATION_PASSWORD_TOO_SHORT') {
        setFieldErrors({
          password: withMin(
            fieldTexts.tooShort,
            minFromParams(result.error.params, passwordMinLength),
          ),
        });
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const codes = fieldErrorCodes(result.error);
        const nameAr = nameError(codes.displayNameAr, fieldTexts);
        const nameEn = nameError(codes.displayNameEn, fieldTexts);
        setFieldErrors({
          ...(nameAr ? { displayNameAr: nameAr } : {}),
          ...(nameEn ? { displayNameEn: nameEn } : {}),
          ...(codes.password
            ? {
                password:
                  codes.password === 'TOO_SMALL'
                    ? withMin(fieldTexts.tooShort, passwordMinLength)
                    : fieldTexts.tooLong,
              }
            : {}),
          ...(codes.confirmPassword ? { confirmPassword: fieldTexts.mismatch } : {}),
          ...(codes.privacyAcknowledged ? { privacyAcknowledged: fieldTexts.privacyRequired } : {}),
        });
      }
      setMessage(errorText(result.error, errors));
    });
  }

  const revealButton = (id: string) => (
    <RevealButton
      shown={reveal}
      onToggle={() => {
        setReveal((v) => !v);
      }}
      showLabel={labels.showPassword}
      hideLabel={labels.hidePassword}
      controls={id}
      disabled={pending}
    />
  );

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <div className="grid gap-3.5 sm:grid-cols-2">
        {/* The page's language first (English by default, PO 14 Oct 2026); both optional: an empty field
            keeps the name the organization entered (either may be missing, PO 17 Oct 2026). */}
        {(locale === 'ar' ? (['ar', 'en'] as const) : (['en', 'ar'] as const)).map((language, i) =>
          language === 'ar' ? (
            <AuthField
              key="ar"
              id="invite-name-ar"
              name="displayNameAr"
              label={labels.displayNameAr}
              marker={labels.optional}
              defaultValue={displayName.ar}
              autoComplete={i === 0 ? 'name' : 'off'}
              maxLength={200}
              dir="rtl"
              lang="ar"
              error={fieldErrors.displayNameAr}
              disabled={pending}
            />
          ) : (
            <AuthField
              key="en"
              id="invite-name-en"
              name="displayNameEn"
              label={labels.displayNameEn}
              marker={labels.optional}
              defaultValue={displayName.en}
              autoComplete={i === 0 ? 'name' : 'off'}
              maxLength={200}
              dir="ltr"
              lang="en"
              error={fieldErrors.displayNameEn}
              disabled={pending}
            />
          ),
        )}
      </div>
      <p className="-mt-3 mb-0 text-[13.5px] text-text-muted">{labels.displayNameHint}</p>
      <AuthField
        id="invite-email"
        icon="mail"
        label={labels.loginEmail}
        hint={labels.loginEmailHint}
        value={email}
        readOnly
        type="email"
        dir="ltr"
        autoComplete="username"
        data-testid="invite-email"
      />
      <div className="flex flex-col gap-2.5">
        <AuthField
          id="invite-password"
          name="password"
          type={reveal ? 'text' : 'password'}
          icon="lock"
          label={labels.password}
          marker={labels.required}
          autoComplete="new-password"
          required
          minLength={passwordMinLength}
          dir="ltr"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          aria-describedby="invite-password-rules"
          error={fieldErrors.password}
          disabled={pending}
          inputEnd={revealButton('invite-password')}
        />
        <PasswordRulesList id="invite-password-rules" rules={rules} labels={labels} />
        <p className="m-0 text-[13.5px] text-text-muted">{labels.passwordTip}</p>
      </div>
      <AuthField
        id="invite-password-confirm"
        name="confirmPassword"
        type={reveal ? 'text' : 'password'}
        icon="lock"
        label={labels.confirmPassword}
        marker={labels.required}
        autoComplete="new-password"
        required
        dir="ltr"
        value={confirmation}
        onChange={(event) => {
          setConfirmation(event.target.value);
        }}
        error={fieldErrors.confirmPassword}
        disabled={pending}
        inputEnd={revealButton('invite-password-confirm')}
      />
      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3 font-medium [&_a]:text-primary-text">
          <input
            type="checkbox"
            name="privacyAcknowledged"
            required
            aria-invalid={fieldErrors.privacyAcknowledged ? true : undefined}
            aria-describedby={fieldErrors.privacyAcknowledged ? 'invite-privacy-error' : undefined}
            disabled={pending}
            className={`mt-0.5 size-5.5 shrink-0 accent-[var(--color-primary)] ${
              fieldErrors.privacyAcknowledged ? 'outline-2 outline-offset-1 outline-danger' : ''
            }`}
            data-testid="invite-privacy"
          />
          <span>{privacyLabel}</span>
        </label>
        {fieldErrors.privacyAcknowledged ? (
          <p
            id="invite-privacy-error"
            className="m-0 flex items-start gap-2 ps-8.5 text-[13.5px] font-semibold text-danger"
          >
            <AuthIcon name="alert" className="mt-px size-4 shrink-0" />
            <span>{fieldErrors.privacyAcknowledged}</span>
          </p>
        ) : null}
      </div>
      {message ? (
        <Alert tone="danger" data-testid="invite-error">
          {message}
        </Alert>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className={authPrimaryButton}
      >
        {pending ? <AuthSpinner /> : null}
        {pending ? labels.submitting : labels.submit}
        {pending ? null : <AuthIcon name="arrow" />}
      </button>
    </form>
  );
}

/** "Sign in to accept": the invitation e-mail already has an account; only its password is asked. */
function SignInToAcceptForm({
  locale,
  token,
  email,
  labels,
  fieldTexts,
  errors,
  onInvalidated,
}: AcceptInvitationFormProps) {
  const outcome = useInviteOutcome(locale, onInvalidated);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('password');
    const password = typeof value === 'string' ? value : '';
    setMessage(null);
    setPasswordError(undefined);
    if (password === '') {
      setPasswordError(fieldTexts.passwordRequired);
      return;
    }
    startTransition(async () => {
      const result = await acceptInvitationWithSignInAction({ token, password });
      if (result.ok) {
        outcome.done(result.value.next);
        return;
      }
      if (outcome.invalidated(result.error)) return;
      setMessage(errorText(result.error, errors));
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={onSubmit}
      noValidate
      data-testid="invite-sign-in"
    >
      <h2 className="m-0 text-xl font-bold">{labels.signInTitle}</h2>
      <Alert tone="info">{labels.signInIntro}</Alert>
      <AuthField
        id="invite-sign-in-email"
        icon="mail"
        label={labels.loginEmail}
        value={email}
        readOnly
        type="email"
        dir="ltr"
        autoComplete="username"
      />
      <AuthField
        id="invite-sign-in-password"
        name="password"
        type="password"
        icon="lock"
        label={labels.password}
        marker={labels.required}
        autoComplete="current-password"
        required
        dir="ltr"
        error={passwordError}
        disabled={pending}
      />
      {message ? (
        <Alert tone="danger" data-testid="invite-error">
          {message}
        </Alert>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className={authPrimaryButton}
      >
        {pending ? <AuthSpinner /> : null}
        {pending ? labels.signInSubmitting : labels.signInSubmit}
      </button>
    </form>
  );
}

/** Signed in with the invited account already: one button accepts with the current session. */
export function AcceptAsSignedInUser({
  locale,
  token,
  labels,
  errors,
  onInvalidated,
}: {
  readonly locale: string;
  readonly token: string;
  readonly labels: { readonly accept: string; readonly accepting: string };
  readonly errors: ErrorTexts;
  readonly onInvalidated: () => void;
}) {
  const outcome = useInviteOutcome(locale, onInvalidated);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {message ? (
        <Alert tone="danger" data-testid="invite-error">
          {message}
        </Alert>
      ) : null}
      <button
        type="button"
        disabled={pending}
        className={authPrimaryButton}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await acceptInvitationAsSignedInUser({ token });
            if (result.ok) {
              outcome.done(result.value.next);
              return;
            }
            if (outcome.invalidated(result.error)) return;
            setMessage(errorText(result.error, errors));
          });
        }}
      >
        {pending ? labels.accepting : labels.accept}
      </button>
    </div>
  );
}

/** Signed in with another account: sign out and stay on this page (the link keeps working). */
export function InviteSignOutButton({
  label,
  pendingLabel,
  onSignedOut,
}: {
  readonly label: string;
  readonly pendingLabel: string;
  readonly onSignedOut: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={authSecondaryButton}
      disabled={pending}
      data-testid="invite-sign-out"
      onClick={() => {
        startTransition(async () => {
          await signOutAction({});
          onSignedOut();
        });
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * The older invitation links (`/{locale}/invite/accept#token=…`, e-mailed before codes): forwarded at once
 * to the sign-up page with the token in the fragment again (`/{locale}/sign-up#code=…`) — the secret never
 * reaches a server log or the history (location.replace).
 */
export function InviteLinkForwarder({
  locale,
  checking,
}: {
  readonly locale: string;
  readonly checking: string;
}) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = inviteCodeFromHash(window.location.hash);
    window.location.replace(`/${locale}/sign-up${signUpFragment(code)}`);
  }, [locale]);
  return (
    <p
      className="m-0 flex items-center gap-3 text-text-muted"
      role="status"
      data-testid="invite-forwarding"
    >
      <AuthSpinner />
      {checking}
    </p>
  );
}
