import 'server-only';
import type { AppLocale } from '@jadarat/platform-i18n';
import { type PlatformPermissionCode, platformPermissions } from '@jadarat/platform-rbac';
import { getTranslations } from 'next-intl/server';
import type { SettingsCommonTexts } from '../components/settings/settings-texts';
import { stepUpHref } from './mfa-view';
import { requestSessionState } from './request-session';
import { stepUpNeeded } from './step-up-view';

/**
 * Shared pieces of the organization settings pages (redesign package 2): the common texts of the save
 * bar, the leave guard, Undo and the «Verify with the app» banner — translated on the server (no i18n
 * runtime in the browser).
 */
export async function settingsCommonTexts(locale: AppLocale): Promise<SettingsCommonTexts> {
  const common = await getTranslations({ locale, namespace: 'common' });
  const mfa = await getTranslations({ locale, namespace: 'mfa' });
  const profile = await getTranslations({ locale, namespace: 'profile' });
  const errors = await getTranslations({ locale, namespace: 'errors' });
  return {
    unsavedChanges: common('unsavedChanges'),
    invalid: errors('validationFailed'),
    undo: common('undo'),
    reload: common('reload'),
    goToField: common.raw('goToField') as string,
    leaveTitle: common('leaveTitle'),
    leaveText: common('leaveText'),
    leaveStay: common('leaveStay'),
    leaveGo: common('leaveGo'),
    edit: common('edit'),
    saved: common('saved'),
    close: common('close'),
    required: common('required'),
    stepUpIntro: mfa('stepUpIntro'),
    verifyFirst: profile('mfa.verifyFirst'),
  };
}

/** The step-up of a settings page: the /mfa link back to it, and whether to ask BEFORE editing. */
export interface PageStepUp {
  readonly href: string;
  /** Saving this page needs a fresh authenticator code (`stepUpNeeded`, PO answer Q2-1). */
  readonly needed: boolean;
}

/**
 * Whether saving this page would need a fresh authenticator code now (`stepUpNeeded`, PO answer Q2-1;
 * never for an organization setting today), and the /mfa link that brings the member back — also used
 * when the server refuses a save for that reason.
 */
export async function pageStepUp(
  locale: AppLocale,
  path: string,
  permission: PlatformPermissionCode,
): Promise<PageStepUp> {
  const session = await requestSessionState();
  const claims = session.kind === 'organization' ? session.claims : null;
  return {
    href: stepUpHref(locale, `/${locale}${path}`),
    needed: stepUpNeeded(platformPermissions[permission], claims),
  };
}

/** The e-mail of the signed-in member (the session's own claims), or null — e.g. to prefill a field. */
export async function sessionEmail(): Promise<string | null> {
  const session = await requestSessionState();
  if (session.kind !== 'organization') return null;
  const email: unknown = 'email' in session.claims ? session.claims.email : undefined;
  return typeof email === 'string' && email.includes('@') ? email : null;
}
