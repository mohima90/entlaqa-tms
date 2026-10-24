'use client';
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
import { requestSignInCodeAction, signInAction } from '../../auth/actions';
import {
  type SignInMethod,
  looksLikeEmail,
  readPreferredMethod,
  rememberMethod,
  signInDestination,
} from '../../lib/sign-in-steps';
import {
  AuthField,
  AuthSpinner,
  RevealButton,
  authPrimaryButton,
  authSecondaryButton,
} from './auth-field';
import { AuthIcon } from './auth-icons';
import { type AuthBrand, AuthShell, type AuthPanelTexts, type AuthShellTexts } from './auth-shell';
import { type ErrorTexts, errorText } from './error-text';
import { type SignInCodeLabels, SignInCodeStep } from './sign-in-code-step';

/** The generic answer for a wrong e-mail or password (never says which: no account enumeration). */
const INVALID_CREDENTIALS = 'auth.errors.invalidCredentials';

export interface SignInFormLabels {
  readonly email: string;
  readonly password: string;
  /** «(مطلوب)» / "(required)" — both fields are required (design principles §4). */
  readonly required: string;
  /** «تذكّر هذا المتصفح» / "Remember this browser" and what it does. */
  readonly rememberBrowser: string;
  readonly rememberBrowserHint: string;
  readonly submit: string;
  readonly submitting: string;
  readonly continue: string;
  readonly changeEmail: string;
  readonly changeEmailAria: string;
  readonly forgotShort: string;
  readonly forgotShortAria: string;
  readonly showPassword: string;
  readonly hidePassword: string;
  readonly emailInvalid: string;
  readonly emailPlaceholder: string;
  readonly passwordPlaceholder: string;
  /** «Email me a code instead» (WP-ADM-05): the button, its separator and the code screen's texts. */
  readonly codeInstead: string;
  readonly or: string;
  readonly sendingCode: string;
  readonly code: SignInCodeLabels;
}

/** The steps of the sign-in form; the page's title and subtitle follow them. */
export type SignInStep = 'email' | 'method' | 'code';

export interface SignInFormProps {
  readonly locale: string;
  /** Sign-in is not configured: the password step cannot be submitted. */
  readonly disabled: boolean;
  readonly labels: SignInFormLabels;
  readonly errors: ErrorTexts;
  /** «Email me a code instead» is offered (Auth's Send Email hook is set up); otherwise only the password. */
  readonly codeSignIn: boolean;
  /** Called when the step changes (the page's subtitle follows the step, Kawadir). */
  readonly onStep?: (step: SignInStep) => void;
}

/**
 * Sign-in in two steps, as Kawadir ATS (PO, 16 Oct 2026): the work e-mail first, then the way in: the
 * password, or «Email me a code instead» (WP-ADM-05) for everybody; the browser remembers the last method
 * used and opens it directly. The e-mail step asks nothing of the server (no account enumeration): every check — the
 * sign-in protection (T-M2-11), the organization's MFA step (T-M2-10) and the same answer for a wrong
 * e-mail or password — stays in `signInAction` (ADR 0003 §2). «تذكّر هذا المتصفح» / "Remember this
 * browser": a native check box, unticked by default, its explanation tied to it (aria-describedby).
 *
 * Direction C (redesign package 1, PO 21 Oct 2026): the main buttons are never disabled because a field
 * is empty — they check when pressed — and the errors sit on the field: an unusable e-mail on the e-mail
 * field, the generic «wrong e-mail or password» (also for an empty password, without asking the server)
 * on the password field. «Too many attempts» and any other refusal (e.g. an outage with its reference)
 * stay a banner. Only "sign-in not configured" disables the password step.
 */
export function SignInForm({
  locale,
  disabled,
  labels,
  errors,
  codeSignIn,
  onStep,
}: SignInFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<SignInStep>('email');
  // «Email me a code instead»: the address the code was asked for and the seconds before a new code.
  const [codeRequest, setCodeRequest] = useState<{
    readonly email: string;
    readonly resendSeconds: number;
  } | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [method, setMethod] = useState<SignInMethod>('password');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);
  // The password field is disabled while signing in, so focus moves to it once the answer is shown.
  const focusPassword = useRef(false);

  useEffect(() => {
    if (pending || !focusPassword.current) return;
    focusPassword.current = false;
    passwordRef.current?.focus();
  }, [pending, passwordError]);

  useEffect(() => {
    onStep?.(step);
    // Focus follows the step after a user action (not on the first render).
    if (!moved.current) return;
    if (step === 'method') passwordRef.current?.focus();
    else emailRef.current?.focus();
  }, [step, onStep]);

  function goToMethod() {
    if (!looksLikeEmail(email)) {
      setEmailError(labels.emailInvalid);
      emailRef.current?.focus();
      return;
    }
    setEmailError(undefined);
    setMessage(null);
    setMethod(readPreferredMethod());
    moved.current = true;
    setStep('method');
  }

  /** «Email me a code instead»: the same screen follows for every address (no account enumeration). */
  function emailMeACode() {
    setMessage(null);
    setPasswordError(undefined);
    const typed = email.trim();
    setSendingCode(true);
    startTransition(async () => {
      const result = await requestSignInCodeAction({ email: typed });
      setSendingCode(false);
      if (result.ok) {
        moved.current = true;
        setCodeRequest({ email: typed, resendSeconds: result.value.resendAfterSeconds });
        setStep('code');
      } else if (result.error.code === 'SIGN_IN_CODE_TOO_SOON' && codeRequest?.email === typed) {
        // A code was just sent for this address: back to its screen, with the seconds left.
        moved.current = true;
        setCodeRequest({
          ...codeRequest,
          resendSeconds: Number(result.error.params?.seconds ?? 60),
        });
        setStep('code');
      } else {
        setMessage(errorText(result.error, errors));
      }
    });
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === 'email') {
      goToMethod();
      return;
    }
    const remember = new FormData(event.currentTarget).get('remember') === 'on';
    setMessage(null);
    setPasswordError(undefined);
    if (password === '') {
      setPasswordError(errors[INVALID_CREDENTIALS]);
      passwordRef.current?.focus();
      return;
    }
    rememberMethod(method);
    startTransition(async () => {
      const result = await signInAction({ email: email.trim(), password, remember });
      if (result.ok) {
        // 'mfa': the organization asks for an authenticator code or app first (T-M2-10).
        router.replace(signInDestination(locale, result.value.next));
        router.refresh();
      } else if (result.error.messageKey === INVALID_CREDENTIALS) {
        setPasswordError(errorText(result.error, errors));
        focusPassword.current = true;
      } else {
        setMessage(errorText(result.error, errors));
      }
    });
  }

  if (step === 'code' && codeRequest) {
    return (
      <SignInCodeStep
        locale={locale}
        email={codeRequest.email}
        resendSeconds={codeRequest.resendSeconds}
        labels={labels.code}
        errors={errors}
        onUsePassword={() => {
          moved.current = true;
          setMessage(null);
          setStep('method');
        }}
      />
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate data-testid="sign-in-form">
      {step === 'email' ? (
        <>
          <AuthField
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            icon="mail"
            label={labels.email}
            marker={labels.required}
            placeholder={labels.emailPlaceholder}
            autoComplete="username"
            required
            maxLength={254}
            dir="ltr"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setEmailError(undefined);
            }}
            error={emailError}
          />
          <button type="submit" className={authPrimaryButton}>
            {labels.continue}
            <AuthIcon name="arrow" />
          </button>
        </>
      ) : (
        <>
          {/* The settled address with one way back (Kawadir's identity chip). Kept in the form as the
              account name for password managers. */}
          <div className="flex min-h-14.5 items-center gap-3 rounded-full border border-border bg-surface-sunken pe-1.5 ps-2.5">
            <span
              aria-hidden="true"
              className="grid size-9.5 shrink-0 place-items-center rounded-full bg-brand-gradient text-[13px] font-semibold text-on-brand"
            >
              {(email.trim()[0] ?? '').toUpperCase()}
            </span>
            <bdi
              dir="ltr"
              className="min-w-0 flex-1 text-[15px] font-semibold text-text [overflow-wrap:anywhere]"
              data-testid="sign-in-email"
            >
              {email.trim()}
            </bdi>
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-full px-3.5 text-sm font-medium text-primary-text hover:bg-primary-subtle"
              aria-label={labels.changeEmailAria}
              disabled={pending}
              onClick={() => {
                moved.current = true;
                setMessage(null);
                setPasswordError(undefined);
                setPassword('');
                setStep('email');
              }}
            >
              {labels.changeEmail}
            </button>
          </div>
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email.trim()}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
          />
          {/* The password method (the only one today; the e-mailed code's controls join here). */}
          <>
            <AuthField
              ref={passwordRef}
              id="password"
              name="password"
              type={reveal ? 'text' : 'password'}
              icon="lock"
              label={labels.password}
              marker={labels.required}
              placeholder={labels.passwordPlaceholder}
              autoComplete="current-password"
              required
              dir="ltr"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (passwordError) setPasswordError(undefined);
              }}
              disabled={disabled || pending}
              error={passwordError}
              errorTestId="sign-in-error"
              labelEnd={
                <a
                  href={`/${locale}/forgot-password`}
                  className="text-sm font-semibold text-primary-text no-underline hover:underline"
                  title={labels.forgotShortAria}
                  data-testid="forgot-password-link"
                >
                  {labels.forgotShort}
                </a>
              }
              inputEnd={
                <RevealButton
                  shown={reveal}
                  onToggle={() => {
                    setReveal((v) => !v);
                  }}
                  showLabel={labels.showPassword}
                  hideLabel={labels.hidePassword}
                  controls="password"
                  disabled={disabled || pending}
                />
              }
            />
            <div className="flex items-start gap-3">
              <input
                id="remember-browser"
                type="checkbox"
                name="remember"
                aria-describedby="remember-browser-hint"
                disabled={disabled || pending}
                className="mt-0.5 size-5.5 shrink-0 accent-[var(--color-primary)]"
                data-testid="remember-browser"
              />
              <div className="flex flex-col gap-0.5">
                <label htmlFor="remember-browser" className="font-medium">
                  {labels.rememberBrowser}
                </label>
                <p id="remember-browser-hint" className="m-0 text-[13.5px] text-text-muted">
                  {labels.rememberBrowserHint}
                </p>
              </div>
            </div>
          </>
          {message ? (
            <Alert tone="danger" data-testid="sign-in-error">
              {message}
            </Alert>
          ) : null}
          <button
            type="submit"
            className={authPrimaryButton}
            disabled={disabled || pending}
            aria-busy={(pending && !sendingCode) || undefined}
          >
            {pending && !sendingCode ? <AuthSpinner /> : null}
            {pending && !sendingCode ? labels.submitting : labels.submit}
            {pending && !sendingCode ? null : <AuthIcon name="arrow" />}
          </button>
          {/* A second way in, instead of the password, for everybody (PO 23 Oct 2026): nothing about the
              account or its roles shows here or on the screen that follows. */}
          {codeSignIn ? (
            <>
              <p
                aria-hidden="true"
                className="m-0 flex items-center gap-3 text-sm text-text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
              >
                {labels.or}
              </p>
              <button
                type="button"
                className={authSecondaryButton}
                disabled={disabled || pending}
                onClick={emailMeACode}
                data-testid="sign-in-email-code"
              >
                {pending && sendingCode ? labels.sendingCode : labels.codeInstead}
              </button>
            </>
          ) : null}
        </>
      )}
    </form>
  );
}

export interface SignInViewProps extends Omit<SignInFormProps, 'onStep'> {
  readonly shell: AuthShellTexts;
  readonly panel: AuthPanelTexts;
  readonly languageSwitch: ReactNode;
  readonly title: string;
  /** The title of the e-mailed-code screens («Check your email»), WP-ADM-05. */
  readonly codeTitle: string;
  /** The subtitle for each step (Kawadir: it follows the step). */
  readonly subtitles: {
    readonly email: string;
    readonly method: string;
    readonly code: string;
  };
  readonly notices?: ReactNode;
  /** Under the card ("Have an invitation code?"). */
  readonly after?: ReactNode;
  /** Inside the card, above the form (e.g. "not configured"). */
  readonly before?: ReactNode;
  /** The organization's look on its sign-in page (WP-ADM-02); null: Jadarat's. */
  readonly brand?: AuthBrand | null;
}

/** The sign-in page body: the Kawadir split frame around the two-step form. */
export function SignInView({
  shell,
  panel,
  languageSwitch,
  title,
  codeTitle,
  subtitles,
  notices,
  after,
  before,
  brand,
  ...form
}: SignInViewProps) {
  const [step, setStep] = useState<SignInStep>('email');
  const onCodeScreen = step === 'code';
  return (
    <AuthShell
      variant="split"
      brand={brand}
      texts={shell}
      panel={panel}
      languageSwitch={languageSwitch}
      title={onCodeScreen ? codeTitle : title}
      subtitle={
        <p>
          {step === 'email' ? subtitles.email : onCodeScreen ? subtitles.code : subtitles.method}
        </p>
      }
      notices={notices}
      after={onCodeScreen ? undefined : after}
    >
      {before}
      <SignInForm {...form} onStep={setStep} />
    </AuthShell>
  );
}
