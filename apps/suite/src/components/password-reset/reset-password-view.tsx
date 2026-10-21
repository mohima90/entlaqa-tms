'use client';
import { Alert } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';
import { completePasswordResetAction } from '../../auth/password-reset';
import { splitTaggedMessage } from '../../lib/invite-link';
import {
  linkIsSpent,
  pathAfterReset,
  resetFragment,
  resetLinkFromHash,
  withMinutesInWords,
} from '../../lib/password-reset-link';
import { PASSWORD_MIN_LENGTH, passwordRuleState, withMin } from '../../lib/password-rules';
import { looksLikeTotpCode } from '../../lib/totp-code-shape';
import {
  AuthField,
  AuthSpinner,
  RevealButton,
  authPrimaryButton,
  authSecondaryButton,
} from '../auth/auth-field';
import { AuthIcon } from '../auth/auth-icons';
import {
  type AuthBrand,
  AuthLanguageSwitch,
  type AuthPanelTexts,
  AuthShell,
  type AuthShellTexts,
} from '../auth/auth-shell';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { type PasswordRuleLabels, PasswordRulesList } from '../auth/password-rules-list';
import { fieldErrorCodes } from '../profile/field-errors';

/**
 * Set a new password (screen 11; FR-IAM-13, NFR-SEC-01, T-M2-08). The e-mailed link carries the token
 * in the URL fragment (`#token_hash=…&type=recovery`): it is read here, removed from the address bar at
 * once and sent only in the body of the server action, together with the new password. Opening the page
 * verifies nothing (a link scanner cannot spend the single-use token). The token is kept in memory only.
 * An account with an authenticator app (`&mfa=1` in the link, T-M2-10) also enters the app's code: Auth
 * sets the password only after it, and the single-use link is spent by that one attempt. When Auth's own
 * mailer sends the link (PASSWORD_RESET_DELIVERY=auth) it cannot say so: the code field is then offered
 * as optional, for accounts with an app.
 * «تذكّر هذا المتصفح» (T-M2-11 re-review N1, the PO's opt-in): a native check box, unticked by default,
 * its explanation tied to it — ticked, this browser is trusted for 30 days; otherwise for 24 hours.
 */
export interface ResetPasswordTexts extends PasswordRuleLabels {
  readonly pageTitle: string;
  readonly opening: string;
  readonly intro: string;
  readonly password: string;
  readonly confirmPassword: string;
  readonly showPassword: string;
  readonly hidePassword: string;
  /** «تذكّر هذا المتصفح» / "Remember this browser" (unticked by default) and what it does here. */
  readonly rememberBrowser: string;
  readonly rememberBrowserHint: string;
  readonly required: string;
  readonly passwordTip: string;
  readonly sessionsNotice: string;
  /** The account uses an authenticator app: why its code is asked, the field, its format error. */
  readonly codeIntro: string;
  /** The link cannot tell (Auth's mailer): the code only for an account with an app. */
  readonly codeOptionalIntro: string;
  readonly optional: string;
  readonly codeLabel: string;
  readonly codeHint: string;
  readonly codeFormat: string;
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
  /** The organization's look (logo, picture; WP-ADM-02), or null for Jadarat's. */
  readonly brand?: AuthBrand | null;
  /** The Kawadir frame (logo, portal line, brand panel). */
  readonly shell: AuthShellTexts;
  readonly panel: AuthPanelTexts;
  /** The language switch: its target (locale-prefixed path without the fragment) and texts. */
  readonly toggle: {
    readonly href: string;
    readonly lang: string;
    readonly label: string;
    readonly ariaLabel: string;
  };
  readonly texts: ResetPasswordTexts;
  readonly errors: ErrorTexts;
  /** Auth's own mailer sends the links (they never say whether the account has an app). */
  readonly codeOptional: boolean;
}

type View =
  | { readonly kind: 'opening' }
  | { readonly kind: 'form'; readonly token: string; readonly needsCode: boolean }
  | { readonly kind: 'spent'; readonly reason: string | null };

function ResetForm({
  locale,
  token,
  needsCode,
  codeOptional,
  texts,
  errors,
  onSpent,
}: {
  readonly locale: 'ar' | 'en';
  readonly token: string;
  readonly needsCode: boolean;
  readonly codeOptional: boolean;
  readonly texts: ResetPasswordTexts;
  readonly errors: ErrorTexts;
  readonly onSpent: (reason: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(false);
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
      setFieldErrors({
        password: rules.minLength ? texts.tooLong : withMin(texts.tooShort, PASSWORD_MIN_LENGTH),
      });
      return;
    }
    if (!rules.matches) {
      setFieldErrors({ confirmPassword: texts.mismatch });
      return;
    }
    // Checked before the single-use link is spent by the one attempt.
    const withCode = needsCode || (codeOptional && code.trim() !== '');
    if (withCode && !looksLikeTotpCode(code)) {
      setFieldErrors({ code: texts.codeFormat });
      return;
    }
    startTransition(async () => {
      const result = await completePasswordResetAction({
        tokenHash: token,
        password,
        confirmPassword: confirmation,
        ...(withCode ? { code } : {}),
        remember,
      });
      if (result.ok) {
        router.replace(pathAfterReset(locale));
        router.refresh();
        return;
      }
      if (linkIsSpent(result.error.code)) {
        onSpent(errorText(withMinutesInWords(result.error, locale), errors));
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const codes = fieldErrorCodes(result.error);
        setFieldErrors({
          ...(codes.password
            ? {
                password:
                  codes.password === 'TOO_SMALL'
                    ? withMin(texts.tooShort, PASSWORD_MIN_LENGTH)
                    : texts.tooLong,
              }
            : {}),
          ...(codes.confirmPassword ? { confirmPassword: texts.mismatch } : {}),
          ...(codes.code ? { code: texts.codeFormat } : {}),
        });
      }
      setMessage(errorText(result.error, errors));
    });
  }

  const reveal_ = (id: string) => (
    <RevealButton
      shown={reveal}
      onToggle={() => {
        setReveal((v) => !v);
      }}
      showLabel={texts.showPassword}
      hideLabel={texts.hidePassword}
      controls={id}
      disabled={pending}
    />
  );

  return (
    <>
      <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-2.5">
          <AuthField
            id="reset-password"
            name="password"
            type={reveal ? 'text' : 'password'}
            icon="lock"
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
            inputEnd={reveal_('reset-password')}
          />
          <PasswordRulesList id="reset-password-rules" rules={rules} labels={texts} />
          <p className="m-0 text-sm text-text-muted">{texts.passwordTip}</p>
        </div>
        <AuthField
          id="reset-password-confirm"
          name="confirmPassword"
          type={reveal ? 'text' : 'password'}
          icon="lock"
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
          inputEnd={reveal_('reset-password-confirm')}
        />
        {needsCode || codeOptional ? (
          <div className="flex flex-col gap-2.5" data-testid="reset-code-step">
            <p className="m-0 text-sm text-text-muted">
              {needsCode ? texts.codeIntro : texts.codeOptionalIntro}
            </p>
            <AuthField
              id="reset-code"
              name="code"
              icon="key"
              label={texts.codeLabel}
              hint={texts.codeHint}
              marker={needsCode ? texts.required : texts.optional}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              required={needsCode}
              dir="ltr"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
              error={fieldErrors.code}
              disabled={pending}
              data-testid="reset-code"
            />
          </div>
        ) : null}
        <div className="flex items-start gap-3">
          <input
            id="reset-remember-browser"
            type="checkbox"
            name="remember"
            checked={remember}
            onChange={(event) => {
              setRemember(event.target.checked);
            }}
            aria-describedby="reset-remember-browser-hint"
            disabled={pending}
            className="mt-0.5 size-5.5 shrink-0 accent-[var(--color-primary)]"
            data-testid="reset-remember-browser"
          />
          <div className="flex flex-col gap-0.5">
            <label htmlFor="reset-remember-browser" className="font-medium">
              {texts.rememberBrowser}
            </label>
            <p id="reset-remember-browser-hint" className="m-0 text-[13.5px] text-text-muted">
              {texts.rememberBrowserHint}
            </p>
          </div>
        </div>
        <Alert tone="info">{texts.sessionsNotice}</Alert>
        {message ? (
          <Alert tone="danger" data-testid="reset-error">
            {message}
          </Alert>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className={authPrimaryButton}
        >
          {pending ? <AuthSpinner /> : <AuthIcon name="lock" className="size-5" />}
          {pending ? texts.submitting : texts.submit}
        </button>
      </form>
      <p className="m-0 text-center text-[13.5px] text-text-muted">
        {validity.before}
        <a href={`/${locale}/forgot-password`} className="text-primary-text underline">
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
  brand,
  shell,
  panel,
  toggle,
  texts,
  errors,
  codeOptional,
}: ResetPasswordViewProps) {
  const [view, setView] = useState<View>({ kind: 'opening' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { hash, pathname, search } = window.location;
    const link = resetLinkFromHash(hash);
    if (hash !== '') {
      window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    }
    setView(
      link
        ? { kind: 'form', token: link.token, needsCode: link.needsCode }
        : { kind: 'spent', reason: null },
    );
  }, []);

  let title = texts.pageTitle;
  let subtitle: string | null = null;
  let spent = false;
  let body;
  if (view.kind === 'opening') {
    body = (
      <p
        className="m-0 flex items-center gap-3 text-text-muted"
        role="status"
        data-testid="reset-opening"
      >
        <AuthSpinner />
        {texts.opening}
      </p>
    );
  } else if (view.kind === 'form') {
    subtitle = texts.intro;
    body = (
      <ResetForm
        locale={locale}
        token={view.token}
        needsCode={view.needsCode}
        codeOptional={codeOptional}
        texts={texts}
        errors={errors}
        onSpent={(reason) => {
          setView({ kind: 'spent', reason });
        }}
      />
    );
  } else {
    title = texts.invalidTitle;
    spent = true;
    body = (
      <section
        className="flex flex-col items-center gap-4 text-center"
        data-testid="reset-link-invalid"
      >
        {view.reason ? (
          <Alert tone="danger" data-testid="reset-error" className="w-full text-start">
            {view.reason}
          </Alert>
        ) : (
          <p className="m-0 text-text-muted">{texts.invalidText}</p>
        )}
        <div className="mt-2 flex w-full flex-col gap-3">
          <a href={`/${locale}/forgot-password`} className={authPrimaryButton}>
            {texts.requestNew}
            <AuthIcon name="arrow" />
          </a>
          <a href={`/${locale}/sign-in`} className={authSecondaryButton}>
            {texts.signIn}
          </a>
        </div>
      </section>
    );
  }

  return (
    <AuthShell
      variant="split"
      // The link used up or expired leads with «Request a new link» under a red tile (direction C).
      icon="lock"
      iconTone={spent ? 'danger' : 'brand'}
      centered={spent}
      size={spent ? 'md' : 'lg'}
      brand={brand}
      texts={shell}
      panel={panel}
      // The language switch keeps the link working: the token goes along in the fragment only.
      languageSwitch={
        <AuthLanguageSwitch
          href={`${toggle.href}${view.kind === 'form' ? resetFragment(view.token, view.needsCode) : ''}`}
          lang={toggle.lang}
          label={toggle.label}
          ariaLabel={toggle.ariaLabel}
        />
      }
      title={title}
      subtitle={subtitle ? <p>{subtitle}</p> : undefined}
    >
      {body}
    </AuthShell>
  );
}
