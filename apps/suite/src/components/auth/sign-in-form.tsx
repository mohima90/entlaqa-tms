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
import { signInAction } from '../../auth/actions';
import {
  type SignInMethod,
  looksLikeEmail,
  readPreferredMethod,
  rememberMethod,
} from '../../lib/sign-in-steps';
import { AuthField, RevealButton, authPrimaryButton } from './auth-field';
import { AuthIcon } from './auth-icons';
import { AuthShell, type AuthPanelTexts, type AuthShellTexts } from './auth-shell';
import { type ErrorTexts, errorText } from './error-text';

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
}

export interface SignInFormProps {
  readonly locale: string;
  /** Sign-in is not configured: the password step cannot be submitted. */
  readonly disabled: boolean;
  readonly labels: SignInFormLabels;
  readonly errors: ErrorTexts;
  /** Called when the step changes (the page's subtitle follows the step, Kawadir). */
  readonly onStep?: (step: 'email' | 'method') => void;
}

/**
 * Sign-in in two steps, as Kawadir ATS (PO, 16 Oct 2026): the work e-mail first, then the way in. Today
 * the only way in is the password (the e-mailed code comes with the platform sender — a second entry of
 * `SignInMethod` then, with the fork between them); the browser remembers the last method used and opens
 * it directly. The e-mail step asks nothing of the server (no account enumeration): every check — the
 * sign-in protection (T-M2-11), the organization's MFA step (T-M2-10) and the same answer for a wrong
 * e-mail or password — stays in `signInAction` (ADR 0003 §2). «تذكّر هذا المتصفح» / "Remember this
 * browser": a native check box, unticked by default, its explanation tied to it (aria-describedby).
 */
export function SignInForm({ locale, disabled, labels, errors, onStep }: SignInFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<'email' | 'method'>('email');
  const [method, setMethod] = useState<SignInMethod>('password');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);

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
      return;
    }
    setEmailError(undefined);
    setMessage(null);
    setMethod(readPreferredMethod());
    moved.current = true;
    setStep('method');
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === 'email') {
      goToMethod();
      return;
    }
    const remember = new FormData(event.currentTarget).get('remember') === 'on';
    setMessage(null);
    rememberMethod(method);
    startTransition(async () => {
      const result = await signInAction({ email: email.trim(), password, remember });
      if (result.ok) {
        const paths = {
          home: '/suite',
          mfa: '/mfa',
          'choose-organization': '/select-organization',
          // A Platform Super Admin without organizations (FR-ADM-17).
          platform: '/platform',
        };
        // 'mfa': the organization asks for an authenticator code or app first (T-M2-10).
        router.replace(`/${locale}${paths[result.value.next]}`);
        router.refresh();
      } else {
        setMessage(errorText(result.error, errors));
      }
    });
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
          <button type="submit" className={authPrimaryButton} disabled={email.trim() === ''}>
            {labels.continue}
            <AuthIcon name="arrow" />
          </button>
        </>
      ) : (
        <>
          {/* The settled address with one way back (Kawadir's identity chip). Kept in the form as the
              account name for password managers. */}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-primary-subtle px-3.5 py-2.5 text-[13px]">
            <bdi
              dir="ltr"
              className="font-semibold text-text [overflow-wrap:anywhere]"
              data-testid="sign-in-email"
            >
              {email.trim()}
            </bdi>
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-md px-2 font-medium text-primary-text hover:underline"
              aria-label={labels.changeEmailAria}
              disabled={pending}
              onClick={() => {
                moved.current = true;
                setMessage(null);
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
              }}
              disabled={disabled || pending}
              labelEnd={
                <a
                  href={`/${locale}/forgot-password`}
                  className="text-[13px] font-medium text-primary-text no-underline hover:underline"
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
            <div className="flex flex-col gap-1">
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  name="remember"
                  aria-describedby="remember-browser-hint"
                  disabled={disabled || pending}
                  className="size-5 shrink-0"
                  data-testid="remember-browser"
                />
                {labels.rememberBrowser}
              </label>
              <p id="remember-browser-hint" className="m-0 ms-8 text-sm text-text-muted">
                {labels.rememberBrowserHint}
              </p>
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
            disabled={disabled || pending || password === ''}
          >
            {pending ? labels.submitting : labels.submit}
            {pending ? null : <AuthIcon name="arrow" />}
          </button>
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
  /** The subtitle for each step (Kawadir: it follows the step). */
  readonly subtitles: { readonly email: string; readonly method: string };
  readonly notices?: ReactNode;
  /** Under the card ("Have an invitation code?"). */
  readonly after?: ReactNode;
  /** Inside the card, above the form (e.g. "not configured"). */
  readonly before?: ReactNode;
}

/** The sign-in page body: the Kawadir split frame around the two-step form. */
export function SignInView({
  shell,
  panel,
  languageSwitch,
  title,
  subtitles,
  notices,
  after,
  before,
  ...form
}: SignInViewProps) {
  const [step, setStep] = useState<'email' | 'method'>('email');
  return (
    <AuthShell
      variant="split"
      texts={shell}
      panel={panel}
      languageSwitch={languageSwitch}
      title={title}
      subtitle={<p className="m-0">{step === 'email' ? subtitles.email : subtitles.method}</p>}
      notices={notices}
      after={after}
    >
      {before}
      <SignInForm {...form} onStep={setStep} />
    </AuthShell>
  );
}
