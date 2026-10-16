'use client';
import type { InvitationLinkView } from '@jadarat/platform-identity';
import { Alert } from '@jadarat/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { lookupInvitationAction } from '../../auth/invitations';
import { isCompleteInviteCode, typedInviteCode } from '../../lib/invite-code';
import {
  inviteCodeFromHash,
  signUpFragment,
  splitLinkMessage,
  withOrganization,
} from '../../lib/invite-link';
import { AuthField, authPrimaryButton, authSecondaryButton } from '../auth/auth-field';
import { AuthIcon } from '../auth/auth-icons';
import { AuthLanguageSwitch, AuthShell, type AuthShellTexts } from '../auth/auth-shell';
import { type ErrorTexts, errorText } from '../auth/error-text';
import {
  AcceptAsSignedInUser,
  AcceptInvitationForm,
  type AcceptInvitationFormProps,
  InviteSignOutButton,
} from './accept-invitation';

type LinkState = 'expired' | 'revoked' | 'used' | 'invalid';

/** Texts of the sign-up page (translated on the server; `{organization}` filled in here). */
export interface SignUpTexts {
  readonly pageTitle: string;
  /** Raw: `{organization}`. */
  readonly titleWithOrg: string;
  readonly intro: string;
  /** Raw: `{organization}`. */
  readonly introValid: string;
  readonly codeLabel: string;
  readonly codePlaceholder: string;
  readonly codeFromLink: string;
  readonly codeChecking: string;
  /** Raw: `{organization}`. */
  readonly codeValid: string;
  readonly codeStates: Readonly<Record<LinkState, string>>;
  readonly emailPreFilled: string;
  /** Raw: `{organization}`. */
  readonly submit: string;
  readonly submitDefault: string;
  readonly haveAccount: string;
  readonly signIn: string;
  /** Raw: `{organization}` and `<link>…</link>`. */
  readonly privacy: string;
  /** Raw: `{organization}`. */
  readonly signedInInvitee: string;
  readonly signedInAccept: string;
  readonly signedInAccepting: string;
  readonly otherAccount: string;
  readonly signOut: string;
  readonly signingOut: string;
  readonly usedSignIn: string;
  readonly usedForgotPassword: string;
  readonly required: string;
}

export interface SignUpViewProps {
  readonly locale: 'ar' | 'en';
  readonly shell: AuthShellTexts;
  /** The language switch: its target (locale-prefixed path without the fragment) and texts. */
  readonly toggle: {
    readonly href: string;
    readonly lang: string;
    readonly label: string;
    readonly ariaLabel: string;
  };
  readonly texts: SignUpTexts;
  readonly formLabels: Omit<AcceptInvitationFormProps['labels'], 'submit' | 'loginEmailHint'>;
  readonly fieldTexts: AcceptInvitationFormProps['fieldTexts'];
  readonly errors: ErrorTexts;
}

type Lookup =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'link'; readonly link: InvitationLinkView }
  | { readonly kind: 'error'; readonly message: string };

const LOOKUP_DELAY_MS = 500;

/**
 * Join with an invitation code — Kawadir ATS's sign-up "join" screen one-to-one (PO, 16 Oct 2026;
 * FR-IAM-03): the code (filled in and locked when it came with the link, else typed — upper-cased, looked
 * up once complete), the organization, the invited e-mail filled in and locked, the names, the password
 * with its live rules, the privacy acknowledgement, «انضم إلى …» → the account is created and signed in.
 * The link carries the code in the URL FRAGMENT (`#code=…`, review M3): read here, removed from the
 * address bar at once (history.replaceState), kept in memory only and sent only in server action bodies.
 * Lookups are limited per client and per code on the server (unknown codes count, fail closed).
 */
export function SignUpView({
  locale,
  shell,
  toggle,
  texts,
  formLabels,
  fieldTexts,
  errors,
}: SignUpViewProps) {
  const [code, setCode] = useState('');
  const [fromLink, setFromLink] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ kind: 'idle' });
  const started = useRef(false);
  const latest = useRef('');

  const describe = useCallback(
    async (value: string) => {
      latest.current = value;
      setLookup({ kind: 'checking' });
      const result = await lookupInvitationAction({ token: value });
      // A newer code was typed meanwhile: its own lookup answers.
      if (latest.current !== value) return;
      if (result.ok) setLookup({ kind: 'link', link: result.value });
      else if (result.error.code === 'VALIDATION_FAILED') {
        setLookup({ kind: 'link', link: { state: 'invalid' } });
      } else setLookup({ kind: 'error', message: errorText(result.error, errors) });
    },
    [errors],
  );

  // The code of the link: read once, removed from the address bar, looked up.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { hash, pathname, search } = window.location;
    const fromHash = inviteCodeFromHash(hash);
    if (hash !== '') window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    if (fromHash) {
      const value = fromHash.length === 43 ? fromHash : typedInviteCode(fromHash);
      // Shown and looked up once the effect has run (the address bar is already clean).
      void Promise.resolve(value).then((settled) => {
        setCode(settled);
        setFromLink(true);
        return describe(settled);
      });
    }
  }, [describe]);

  // A typed code: looked up once complete, after a short pause (Kawadir: 500 ms).
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );
  const onType = (raw: string) => {
    const value = typedInviteCode(raw);
    setCode(value);
    window.clearTimeout(timer.current);
    latest.current = '';
    setLookup({ kind: 'idle' });
    if (!isCompleteInviteCode(value)) return;
    timer.current = window.setTimeout(() => {
      void describe(value);
    }, LOOKUP_DELAY_MS);
  };

  const reload = useCallback(() => {
    if (code) void describe(code);
  }, [code, describe]);

  const link = lookup.kind === 'link' ? lookup.link : null;
  const valid = link?.state === 'valid' ? link : null;
  const organization = valid
    ? locale === 'en'
      ? (valid.organizationName.en ?? valid.organizationName.ar)
      : valid.organizationName.ar
    : null;
  const stateText = link && link.state !== 'valid' ? texts.codeStates[link.state] : null;

  const codeStatus =
    lookup.kind === 'checking' ? (
      <span className="flex items-center gap-2 text-sm text-text-muted">{texts.codeChecking}</span>
    ) : organization ? (
      <span
        className="flex items-center gap-2 text-sm font-medium text-success"
        data-testid="sign-up-code-valid"
      >
        <AuthIcon name="check" className="size-4 shrink-0" />
        {withOrganization(texts.codeValid, organization)}
      </span>
    ) : null;

  let body = null;
  if (lookup.kind === 'error') {
    body = (
      <Alert tone="danger" data-testid="invite-error">
        {lookup.message}
      </Alert>
    );
  } else if (link?.state === 'used') {
    body = (
      <div className="flex flex-col gap-3" data-testid="invite-state-used">
        <a href={`/${locale}/sign-in`} className={authPrimaryButton}>
          {texts.usedSignIn}
        </a>
        <a href={`/${locale}/forgot-password`} className={authSecondaryButton}>
          {texts.usedForgotPassword}
        </a>
      </div>
    );
  } else if (valid && organization) {
    if (valid.viewer === 'invitee') {
      body = (
        <div className="flex flex-col gap-4">
          <p className="m-0">{withOrganization(texts.signedInInvitee, organization)}</p>
          <AcceptAsSignedInUser
            locale={locale}
            token={code}
            labels={{ accept: texts.signedInAccept, accepting: texts.signedInAccepting }}
            errors={errors}
            onInvalidated={reload}
          />
        </div>
      );
    } else if (valid.viewer === 'other-account') {
      body = (
        <div className="flex flex-col gap-4">
          <Alert tone="warning" data-testid="invite-other-account">
            {texts.otherAccount}
          </Alert>
          <InviteSignOutButton
            label={texts.signOut}
            pendingLabel={texts.signingOut}
            onSignedOut={reload}
          />
        </div>
      );
    } else {
      const privacy = splitLinkMessage(withOrganization(texts.privacy, organization));
      body = (
        <AcceptInvitationForm
          locale={locale}
          token={code}
          email={valid.email}
          displayName={{ ar: valid.displayName.ar, en: valid.displayName.en ?? '' }}
          passwordMinLength={valid.passwordMinLength}
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
          labels={{
            ...formLabels,
            loginEmailHint: texts.emailPreFilled,
            submit: withOrganization(texts.submit, organization),
          }}
          fieldTexts={fieldTexts}
          errors={errors}
          onInvalidated={reload}
        />
      );
    }
  }

  return (
    <AuthShell
      variant="centered"
      texts={shell}
      icon="userPlus"
      // The language switch keeps the code: it goes along in the fragment only.
      languageSwitch={
        <AuthLanguageSwitch
          href={`${toggle.href}${signUpFragment(code || null)}`}
          lang={toggle.lang}
          label={toggle.label}
          ariaLabel={toggle.ariaLabel}
        />
      }
      title={organization ? withOrganization(texts.titleWithOrg, organization) : texts.pageTitle}
      subtitle={
        <p className="m-0">
          {organization ? withOrganization(texts.introValid, organization) : texts.intro}
        </p>
      }
      after={
        <p className="m-0 text-center text-sm text-text-muted">
          {texts.haveAccount}{' '}
          <a href={`/${locale}/sign-in`} className="font-semibold text-primary-text">
            {texts.signIn}
          </a>
        </p>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <AuthField
            id="sign-up-code"
            name="code"
            icon="key"
            label={texts.codeLabel}
            marker={texts.required}
            placeholder={texts.codePlaceholder}
            value={code}
            readOnly={fromLink}
            onChange={(event) => {
              onType(event.target.value);
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            dir="ltr"
            maxLength={fromLink ? 43 : 8}
            inputClassName="font-mono uppercase tracking-[0.2em]"
            hint={fromLink ? texts.codeFromLink : undefined}
            error={stateText ?? undefined}
            aria-describedby="sign-up-code-status"
            data-testid="sign-up-code"
          />
          {/* Announced as it changes: checking, valid for which organization. */}
          <div id="sign-up-code-status" role="status" aria-live="polite">
            {codeStatus}
          </div>
        </div>
        {body}
        {!valid && link?.state !== 'used' && lookup.kind !== 'error' ? (
          <button type="button" className={authPrimaryButton} disabled>
            {texts.submitDefault}
          </button>
        ) : null}
      </div>
    </AuthShell>
  );
}
