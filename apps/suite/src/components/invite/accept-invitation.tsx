'use client';
import type { AppError } from '@jadarat/platform-core';
import type { InvitationLinkView } from '@jadarat/platform-identity';
import { Alert, Button, Card, TextField, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
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
  lookupInvitationAction,
} from '../../auth/invitations';
import {
  inviteFragment,
  inviteTokenFromHash,
  splitLinkMessage,
  withOrganization,
} from '../../lib/invite-link';
import { passwordRuleState } from '../../lib/password-rules';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { PasswordRulesList } from '../auth/password-rules-list';
import { fieldErrorCodes } from '../profile/field-errors';

/**
 * Invitee side of an invitation (screens 8 and 9; FR-IAM-03, T-M2-07). The e-mailed link carries the
 * token in the URL fragment (`#token=…`, review M3): it is read here, removed from the address bar at
 * once, and travels only in the body of the server actions — never in a URL the server sees, never
 * logged or stored in the browser.
 */

type Next = 'home' | 'choose-organization' | 'sign-in';

function nextPath(locale: string, next: Next): string {
  if (next === 'home') return `/${locale}/suite`;
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
    readonly rulesLabel: string;
    readonly ruleMinLength: string;
    readonly ruleMaxBytes: string;
    readonly ruleMatches: string;
    readonly ruleMet: string;
    readonly ruleNotMet: string;
    readonly passwordTip: string;
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
  const rules = passwordRuleState(password, confirmation);

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
      if (result.error.code === 'VALIDATION_FAILED') {
        const codes = fieldErrorCodes(result.error);
        const nameAr = nameError(codes.displayNameAr, fieldTexts);
        const nameEn = nameError(codes.displayNameEn, fieldTexts);
        setFieldErrors({
          ...(nameAr ? { displayNameAr: nameAr } : {}),
          ...(nameEn ? { displayNameEn: nameEn } : {}),
          ...(codes.password
            ? {
                password: codes.password === 'TOO_SMALL' ? fieldTexts.tooShort : fieldTexts.tooLong,
              }
            : {}),
          ...(codes.confirmPassword ? { confirmPassword: fieldTexts.mismatch } : {}),
          ...(codes.privacyAcknowledged ? { privacyAcknowledged: fieldTexts.privacyRequired } : {}),
        });
      }
      setMessage(errorText(result.error, errors));
    });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <TextField
        id="invite-email"
        label={labels.loginEmail}
        hint={labels.loginEmailHint}
        value={email}
        readOnly
        type="email"
        dir="ltr"
        autoComplete="username"
        data-testid="invite-email"
      />
      <TextField
        id="invite-name-ar"
        name="displayNameAr"
        label={labels.displayNameAr}
        marker={labels.optional}
        hint={labels.displayNameHint}
        defaultValue={displayName.ar}
        autoComplete="name"
        maxLength={200}
        dir="rtl"
        lang="ar"
        error={fieldErrors.displayNameAr}
        disabled={pending}
      />
      <TextField
        id="invite-name-en"
        name="displayNameEn"
        label={labels.displayNameEn}
        marker={labels.optional}
        defaultValue={displayName.en}
        autoComplete="off"
        maxLength={200}
        dir="ltr"
        lang="en"
        error={fieldErrors.displayNameEn}
        disabled={pending}
      />
      <div className="flex flex-col gap-2">
        <TextField
          id="invite-password"
          name="password"
          type={reveal ? 'text' : 'password'}
          label={labels.password}
          marker={labels.required}
          autoComplete="new-password"
          required
          minLength={12}
          dir="ltr"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          aria-describedby="invite-password-rules"
          error={fieldErrors.password}
          disabled={pending}
        />
        <PasswordRulesList id="invite-password-rules" rules={rules} labels={labels} />
        <p className="m-0 text-sm text-text-muted">{labels.passwordTip}</p>
      </div>
      <TextField
        id="invite-password-confirm"
        name="confirmPassword"
        type={reveal ? 'text' : 'password'}
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
        {labels.showPassword}
      </label>
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="privacyAcknowledged"
            required
            aria-invalid={fieldErrors.privacyAcknowledged ? true : undefined}
            aria-describedby={fieldErrors.privacyAcknowledged ? 'invite-privacy-error' : undefined}
            disabled={pending}
            className="mt-1 size-5 shrink-0"
            data-testid="invite-privacy"
          />
          <span>{privacyLabel}</span>
        </label>
        {fieldErrors.privacyAcknowledged ? (
          <p id="invite-privacy-error" className="m-0 text-sm font-medium text-danger">
            {fieldErrors.privacyAcknowledged}
          </p>
        ) : null}
      </div>
      {message ? (
        <Alert tone="danger" data-testid="invite-error">
          {message}
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? labels.submitting : labels.submit}
      </Button>
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
      <h2 className="m-0 text-lg font-semibold">{labels.signInTitle}</h2>
      <Alert tone="info">{labels.signInIntro}</Alert>
      <TextField
        id="invite-sign-in-email"
        label={labels.loginEmail}
        value={email}
        readOnly
        type="email"
        dir="ltr"
        autoComplete="username"
      />
      <TextField
        id="invite-sign-in-password"
        name="password"
        type="password"
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
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? labels.signInSubmitting : labels.signInSubmit}
      </Button>
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
      <Button
        type="button"
        disabled={pending}
        className="w-full"
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
      </Button>
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
    <Button
      type="button"
      variant="secondary"
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
    </Button>
  );
}

type LinkState = 'expired' | 'revoked' | 'used' | 'invalid';

const STATE_ICONS: Record<LinkState, { readonly className: string; readonly path: ReactNode }> = {
  expired: {
    className: 'bg-warning-subtle',
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  revoked: {
    className: 'bg-surface-sunken',
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M6 18L18 6" />
      </>
    ),
  },
  used: { className: 'bg-success-subtle', path: <path d="M5 12l5 5 9-10" /> },
  invalid: {
    className: 'bg-surface-sunken',
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16v.5" />
      </>
    ),
  },
};

/** Texts of the accept page (translated on the server; `{organization}` filled in here). */
export interface InviteViewTexts {
  readonly pageTitle: string;
  readonly checking: string;
  /** Raw: `{organization}`. */
  readonly welcomeTitle: string;
  readonly intro: string;
  /** Raw: `{organization}` and `<link>…</link>`. */
  readonly privacy: string;
  /** Raw: `{organization}`. */
  readonly signedInInvitee: string;
  readonly signedInAccept: string;
  readonly signedInAccepting: string;
  readonly otherAccount: string;
  readonly signOut: string;
  readonly signingOut: string;
  readonly states: Readonly<Record<LinkState, { readonly title: string; readonly text: string }>>;
  readonly usedSignIn: string;
  readonly usedForgotPassword: string;
}

export interface InviteAcceptViewProps {
  readonly locale: string;
  readonly productName: string;
  /** The language switch: its target (locale-prefixed path without the fragment) and texts. */
  readonly toggle: {
    readonly href: string;
    readonly lang: string;
    readonly label: string;
    readonly ariaLabel: string;
  };
  readonly texts: InviteViewTexts;
  readonly formLabels: AcceptInvitationFormProps['labels'];
  readonly fieldTexts: AcceptInvitationFormProps['fieldTexts'];
  readonly errors: ErrorTexts;
}

type ViewState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'link'; readonly link: InvitationLinkView }
  | { readonly kind: 'error'; readonly message: string };

/**
 * The accept page body (screens 8 and 9). On load: read the token from the URL fragment, remove the
 * fragment from the address bar (history.replaceState: not in the history, not in a bookmark), then
 * ask the server what the link is. The token is kept in memory only.
 */
export function InviteAcceptView({
  locale,
  productName,
  toggle,
  texts,
  formLabels,
  fieldTexts,
  errors,
}: InviteAcceptViewProps) {
  const [state, setState] = useState<{ readonly token: string | null; readonly view: ViewState }>({
    token: null,
    view: { kind: 'checking' },
  });
  const started = useRef(false);

  const describe = useCallback(
    async (token: string | null): Promise<ViewState> => {
      if (!token) return { kind: 'link', link: { state: 'invalid' } };
      const result = await lookupInvitationAction({ token });
      if (result.ok) return { kind: 'link', link: result.value };
      if (result.error.code === 'VALIDATION_FAILED') {
        return { kind: 'link', link: { state: 'invalid' } };
      }
      return { kind: 'error', message: errorText(result.error, errors) };
    },
    [errors],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { hash, pathname, search } = window.location;
    const token = inviteTokenFromHash(hash);
    if (hash !== '') {
      window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    }
    void describe(token).then((view) => {
      setState({ token, view });
    });
  }, [describe]);

  const reload = useCallback(() => {
    void describe(state.token).then((view) => {
      setState((current) => ({ ...current, view }));
    });
  }, [describe, state.token]);

  const { token, view } = state;
  let title: string;
  let body: ReactNode;
  if (view.kind === 'checking') {
    title = texts.pageTitle;
    body = (
      <Card>
        <p className="m-0 text-text-muted" role="status" data-testid="invite-checking">
          {texts.checking}
        </p>
      </Card>
    );
  } else if (view.kind === 'error') {
    title = texts.pageTitle;
    body = (
      <Alert tone="danger" data-testid="invite-error">
        {view.message}
      </Alert>
    );
  } else if (view.link.state !== 'valid') {
    const linkState = view.link.state;
    const icon = STATE_ICONS[linkState];
    title = texts.states[linkState].title;
    body = (
      <Card data-testid={`invite-state-${linkState}`}>
        <div className="flex flex-col items-start gap-3">
          <span
            className={`inline-flex size-12 items-center justify-center rounded-full ${icon.className}`}
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
              {icon.path}
            </svg>
          </span>
          <p className="m-0">{texts.states[linkState].text}</p>
          {linkState === 'used' ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={`/${locale}/sign-in`} className={buttonClasses({ variant: 'primary' })}>
                {texts.usedSignIn}
              </a>
              <a
                href={`/${locale}/forgot-password`}
                className={buttonClasses({ variant: 'secondary' })}
              >
                {texts.usedForgotPassword}
              </a>
            </div>
          ) : null}
        </div>
      </Card>
    );
  } else {
    const link = view.link;
    const organization =
      locale === 'en'
        ? (link.organizationName.en ?? link.organizationName.ar)
        : link.organizationName.ar;
    title = withOrganization(texts.welcomeTitle, organization);
    if (link.viewer === 'invitee' && token) {
      body = (
        <Card>
          <div className="flex flex-col gap-4">
            <p className="m-0">{withOrganization(texts.signedInInvitee, organization)}</p>
            <AcceptAsSignedInUser
              locale={locale}
              token={token}
              labels={{ accept: texts.signedInAccept, accepting: texts.signedInAccepting }}
              errors={errors}
              onInvalidated={reload}
            />
          </div>
        </Card>
      );
    } else if (link.viewer === 'other-account') {
      body = (
        <Card>
          <div className="flex flex-col items-start gap-4">
            <Alert tone="warning" data-testid="invite-other-account">
              {texts.otherAccount}
            </Alert>
            <InviteSignOutButton
              label={texts.signOut}
              pendingLabel={texts.signingOut}
              onSignedOut={reload}
            />
          </div>
        </Card>
      );
    } else {
      const privacy = splitLinkMessage(withOrganization(texts.privacy, organization));
      body = (
        <>
          <p className="m-0 text-text-muted">{texts.intro}</p>
          <Card>
            <AcceptInvitationForm
              locale={locale}
              token={token ?? ''}
              email={link.email}
              displayName={{ ar: link.displayName.ar, en: link.displayName.en ?? '' }}
              privacyLabel={
                <>
                  {privacy.before}
                  {/* TODO(PO): no privacy notice page exists yet; /[locale]/privacy is a placeholder. */}
                  <a href={`/${locale}/privacy`} className="underline">
                    {privacy.link}
                  </a>
                  {privacy.after}
                </>
              }
              labels={formLabels}
              fieldTexts={fieldTexts}
              errors={errors}
              onInvalidated={reload}
            />
          </Card>
        </>
      );
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg font-semibold">{productName}</span>
        {/* The language switch keeps the link working: the token goes along in the fragment only. */}
        <a
          href={`${toggle.href}${inviteFragment(token)}`}
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
