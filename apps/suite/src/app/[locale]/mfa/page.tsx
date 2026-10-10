import { toClientError } from '@jadarat/platform-core';
import { DEFAULT_CALENDAR, DEFAULT_NUMBERING_SYSTEM } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { getMfaPageStateForRequest } from '@jadarat/platform-identity/auth';
import { Alert, Card } from '@jadarat/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { SignOutButton } from '../../../components/auth/sign-out-button';
import { LanguageToggle } from '../../../components/language-toggle';
import {
  type MfaTexts,
  MfaChallenge,
  MfaElsewhere,
  MfaPending,
  MfaSetup,
} from '../../../components/mfa/mfa-flow';
import { mfaErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';
import { mayContinueWithoutApp, mfaPageMode, safeNextPath } from '../../../lib/mfa-view';
import { getSessionState, redirectFor } from '../../../lib/session-state';
import { describeUserAgent } from '../../../lib/user-agent';

/**
 * Multi-factor authentication (FR-IAM-12, T-M2-10; screens 6 and 8 step 2): the code from the account's
 * authenticator app, or setting one up — when the organization's policy asks for it at sign-in (the
 * database refuses the session until then), when a sensitive action needs a code (`?next=`, PO decision
 * D-IAM-01; again when the last code is older than 15 minutes, review L3), or as the set-up prompt (grace
 * period; Organization Admins, PO decision 2). A new app counts only once the window that set it up entered
 * the one-time code e-mailed to its owner (re-review N1): that window asks for the code; every other sign-in
 * of the account is told "an app was added from another sign-in on … with …" and can remove it (the sign-in
 * sends every session of such an account here). `next` is only ever a suite page in the same language
 * (safeNextPath).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'mfa' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function MfaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const status = getConfigStatus();
  const session = await getSessionState(status);
  const elsewhere = redirectFor(locale, session, 'mfa');
  if (elsewhere) redirect(elsewhere);

  const requested = safeNextPath((await searchParams).next);
  // A sensitive action returns to its page in the same language only.
  const stepUpPath = requested?.startsWith(`/${locale}/`) ? requested : null;
  const next = stepUpPath ?? `/${locale}/suite`;
  const state = await getMfaPageStateForRequest();
  if (!state.ok) {
    if (toClientError(state.error).code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
    throw new Error('the MFA page state could not be read');
  }
  const { access, apps } = state.value;
  // Apps waiting for the e-mailed code: set up by this window, or added from another sign-in (N1).
  const pendingHere = apps.find((app) => !app.confirmed && app.here) ?? null;
  const pendingElsewhere = apps.find((app) => !app.confirmed && !app.here) ?? null;
  const mode = mfaPageMode({
    state: access.state,
    // What the database counts: a CONFIRMED app, and a code from it in this session (review H1)…
    usesApp: access.usesApp,
    pendingHere: pendingHere !== null,
    pendingElsewhere: pendingElsewhere !== null,
    // …recent enough for a sensitive action (STEP_UP_MAX_AGE_SECONDS, review L3).
    verified: access.aal2 && state.value.codeFresh,
    stepUp: stepUpPath !== null,
  });
  if (mode === 'done') redirect(next);

  const t = await getTranslations({ locale, namespace: 'mfa' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const auth = await getTranslations({ locale, namespace: 'auth' });
  const format = await getFormatter({ locale });
  const texts: MfaTexts = {
    codeLabel: t('codeLabel'),
    codeHint: t('codeHint'),
    verify: t('verify'),
    verifying: t('verifying'),
    start: t('start'),
    starting: t('starting'),
    scanStep: t('scanStep'),
    qrAlt: t('qrAlt'),
    keyStep: t('keyStep'),
    keyLabel: t('keyLabel'),
    codeStep: t('codeStep'),
    finish: t('finish'),
    notNow: t('notNow'),
    notNowHint: t('notNowHint'),
    continueWithout: t('continueWithout'),
    appsHint: t('appsHint'),
    codeFormat: t('errors.codeFormat'),
  };
  const errors = await mfaErrorTexts(locale);
  const deadline = access.mfaDeadline;
  const mayContinue = mayContinueWithoutApp(access.state, stepUpPath !== null);

  let title: string;
  let intro: string;
  if (mode === 'challenge') {
    title = t('challengeTitle');
    // A code from the confirmed app passed in this session, but too long ago for a sensitive action.
    const stale = state.value.sessionVerified && access.aal2;
    intro = stepUpPath ? (stale ? t('stepUpAgainIntro') : t('stepUpIntro')) : t('challengeIntro');
  } else if (mode === 'pending') {
    title = t('pending.title');
    intro = t('pending.intro');
  } else if (mode === 'pending-elsewhere' && pendingElsewhere) {
    title = t('elsewhere.title');
    const device = describeUserAgent(pendingElsewhere.userAgent);
    intro = t('elsewhere.intro', {
      date: format.dateTime(pendingElsewhere.setUpAt, {
        dateStyle: 'long',
        timeStyle: 'short',
        calendar: DEFAULT_CALENDAR,
        numberingSystem: DEFAULT_NUMBERING_SYSTEM,
      }),
      device:
        device.browser && device.system
          ? t('elsewhere.device', { browser: device.browser, system: device.system })
          : (device.browser ?? device.system ?? t('elsewhere.unknownDevice')),
    });
  } else {
    title = t('enrolTitle');
    if (mode === 'prompt-admin') intro = t('promptAdmin');
    else if (mode === 'prompt-grace' && deadline) {
      intro = t('promptGrace', {
        date: format.dateTime(deadline, {
          dateStyle: 'long',
          calendar: DEFAULT_CALENDAR,
          numberingSystem: DEFAULT_NUMBERING_SYSTEM,
        }),
      });
    } else intro = stepUpPath ? t('enrolStepUp') : t('enrolRequired');
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg font-semibold">{common('productName')}</span>
        <div className="flex items-center gap-2">
          <LanguageToggle locale={locale} path="/mfa" />
          <SignOutButton
            locale={locale}
            label={auth('signOut')}
            pendingLabel={auth('signingOut')}
          />
        </div>
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10"
        data-testid={`mfa-${mode}`}
      >
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm text-text-muted">{t('title')}</p>
          <h1 className="m-0 text-2xl font-bold">{title}</h1>
        </div>
        <Alert
          tone={
            mode === 'challenge' || mode === 'enrol'
              ? 'info'
              : mode === 'pending-elsewhere'
                ? 'danger'
                : 'warning'
          }
          data-testid="mfa-intro"
        >
          {intro}
        </Alert>
        <Card>
          {mode === 'challenge' ? (
            <MfaChallenge next={next} texts={texts} errors={errors} />
          ) : mode === 'pending' && pendingHere ? (
            <MfaPending
              factorId={pendingHere.factorId}
              next={next}
              mayContinue={mayContinue}
              texts={{
                delay: t('pending.delay'),
                codeLabel: t('pending.codeLabel'),
                codeHint: t('pending.codeHint'),
                codeFormat: t('pending.codeFormat'),
                confirm: t('pending.confirm'),
                confirming: t('pending.confirming'),
                notMe: t('pending.notMe'),
                resend: t('pending.resend'),
                resending: t('pending.resending'),
                resent: t('pending.resent'),
                resentWaiting: t('pending.resentWaiting'),
                cancel: t('pending.cancel'),
                cancelling: t('pending.cancelling'),
                continueWithout: t('continueWithout'),
              }}
              errors={errors}
            />
          ) : mode === 'pending-elsewhere' && pendingElsewhere ? (
            <MfaElsewhere
              locale={locale}
              factorId={pendingElsewhere.factorId}
              next={next}
              mayContinue={mayContinue}
              texts={{
                notMeHint: t('elsewhere.notMeHint'),
                remove: t('elsewhere.remove'),
                removing: t('elsewhere.removing'),
                removed: t('elsewhere.removed'),
                newPassword: t('elsewhere.newPassword'),
                continue: t('elsewhere.continue'),
                itWasMe: t('elsewhere.itWasMe'),
                itWasMeText: t('elsewhere.itWasMeText'),
                itWasMeClosed: t('elsewhere.itWasMeClosed'),
                continueWithout: t('continueWithout'),
              }}
              errors={errors}
            />
          ) : (
            <MfaSetup
              next={next}
              skip={mode === 'prompt-admin' ? 'admin' : mode === 'prompt-grace' ? 'grace' : null}
              texts={texts}
              errors={errors}
            />
          )}
        </Card>
        {stepUpPath ? (
          <p className="m-0">
            <a href={stepUpPath}>{t('back')}</a>
          </p>
        ) : null}
        <p className="m-0 text-sm text-text-muted">{t('lostDevice')}</p>
      </main>
    </div>
  );
}
