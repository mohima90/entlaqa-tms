import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { actionButton, link, ltr, paragraph, renderLayout } from '../layout';
import { arabicMinutes } from './account-locked';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');

/**
 * "Wrong codes after your password" (integration review T-M2-11 M1; FR-IAM-12/13): sent by our notification
 * service when wrong verification codes of a signed-in session — at sign-in, before a sensitive action, or
 * the e-mailed set-up code — pause code checks for the account. Reaching a code takes the account's
 * password, so the person is told plainly that someone who knows it tried, that code checks are paused
 * for `lockMinutes`, to set a new password (the "forgot password" page: its own code check is not
 * paused) and tell the Organization Admin if it was not them, and that a legitimate try works again
 * after the pause. A security notice: at most one per pause; over the account's daily ceiling it is merged
 * into the security digest. Same tone as the "sign-in paused" notice (account-locked.ts).
 * Arabic copy to be confirmed by the UX writer (docs/design/content/glossary-ar-en.md: «مدير المنظمة»,
 * «كلمة المرور», «تطبيق المصادقة», «رمز التحقق»).
 */
export const MfaCodeLockedVariables = z.strictObject({
  organizationName: Localized(150),
  /** How long code checks pause (minutes). */
  lockMinutes: z.number().int().min(1).max(1440),
  /** The "forgot password" page in each language. */
  forgotPasswordUrl: z.strictObject({ ar: Link, en: Link }),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type MfaCodeLockedVariables = z.output<typeof MfaCodeLockedVariables>;

function englishMinutes(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
}

const TEXT = {
  ar: {
    title: 'رموز تحقق خاطئة بعد إدخال كلمة مرورك',
    paused: (minutes: string) => `لذلك أوقفنا التحقق من الرموز لهذا الحساب مؤقتًا لمدة ${minutes}.`,
    action: 'تعيين كلمة مرور جديدة',
    advice:
      'إن لم تكن هذه المحاولات منك، فكلمة مرورك معروفة لغيرك: عيّن كلمة مرور جديدة الآن وأبلغ مدير المنظمة. تعيين كلمة مرور جديدة يُنهي جلسات الدخول على جميع الأجهزة، ويطلب رمزًا من تطبيق المصادقة، وهذا متاح لك الآن.',
    yours: (minutes: string) =>
      `إن كانت المحاولات منك، فيمكنك المحاولة من جديد بعد ${minutes} بالرمز الظاهر في التطبيق حينها.`,
    once: 'نرسل هذا التنبيه مرة واحدة على الأكثر في كل إيقاف.',
  },
  en: {
    title: 'Wrong codes after your password was entered',
    paused: (minutes: string) => `So we paused code checks for this account for ${minutes}.`,
    action: 'Set a new password',
    advice:
      "If this wasn't you, someone else knows your password: set a new password now and tell your organization's administrator. Setting a new password signs you out on every device and asks for a code from your authenticator app — you can do it right away.",
    yours: (minutes: string) =>
      `If it was you, try again after ${minutes} with the code your app shows at that time.`,
    once: 'We send this notice at most once per pause.',
  },
} as const;

function minutesIn(locale: AppLocale, minutes: number): string {
  return locale === 'ar' ? arabicMinutes(minutes) : englishMinutes(minutes);
}

function body(v: MfaCodeLockedVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const t = TEXT[locale];
  const url = v.forgotPasswordUrl[locale];
  const minutes = minutesIn(locale, v.lockMinutes);
  const heading = primary ? (locale === 'ar' ? '23px' : '22px') : locale === 'ar' ? '18px' : '17px';
  const lead =
    locale === 'ar'
      ? markup`أُدخلت كلمة مرور الحساب ${ltr(v.loginEmail)} صحيحة، ثم عدة رموز تحقق خاطئة.`
      : markup`The password of ${v.loginEmail} was entered correctly, then several wrong verification codes.`;
  return markup`<h1 style="margin: 0 0 14px 0; font-size: ${heading}; line-height: 1.5">${t.title}</h1>
    ${paragraph(lead)}
    ${paragraph(markup`${t.paused(minutes)}`)}
    ${paragraph(markup`${t.advice}`)}
    ${primary ? actionButton(t.action, url) : paragraph(link(t.action, url))}
    ${paragraph(markup`${t.yours(minutes)}`, true, true)}
    ${paragraph(markup`${t.once}`, true, true)}`;
}

function plain(v: MfaCodeLockedVariables, locale: AppLocale): string {
  const t = TEXT[locale];
  const minutes = minutesIn(locale, v.lockMinutes);
  const lead =
    locale === 'ar'
      ? `أُدخلت كلمة مرور الحساب ${v.loginEmail} صحيحة، ثم عدة رموز تحقق خاطئة.`
      : `The password of ${v.loginEmail} was entered correctly, then several wrong verification codes.`;
  return [
    t.title,
    '',
    lead,
    t.paused(minutes),
    t.advice,
    `${t.action}:`,
    v.forgotPasswordUrl[locale],
    '',
    t.yours(minutes),
    t.once,
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: `${TEXT.ar.title} · ${TEXT.en.title}`,
  en: `${TEXT.en.title} · ${TEXT.ar.title}`,
};

export const mfaCodeLockedTemplate: EmailTemplate<typeof MfaCodeLockedVariables> = {
  key: 'platform.mfa_code_locked',
  version: 1,
  variables: MfaCodeLockedVariables,
  render(v, primary) {
    const secondary = otherLocale(primary);
    const subject = SUBJECT[primary];
    const html = renderLayout({
      title: subject,
      organizationName: localizedName(v.organizationName, primary),
      productLabel: PRODUCT[primary],
      primary: { locale: primary, content: body(v, primary, true) },
      secondary: { locale: secondary, content: body(v, secondary, false) },
      footer: [
        { locale: 'ar', content: markup`رسالة أمان أُرسلت إلى ${ltr(v.loginEmail)}.` },
        { locale: 'en', content: markup`Security notice sent to ${v.loginEmail}.` },
        { locale: primary, content: markup`${SIGNATURE[primary]}` },
      ],
    });
    const textBody = [
      plain(v, primary),
      '',
      '———',
      '',
      plain(v, secondary),
      '',
      '———',
      `رسالة أمان أُرسلت إلى ${v.loginEmail}.`,
      `Security notice sent to ${v.loginEmail}.`,
    ].join('\n');
    return { subject, html, text: textBody };
  },
};
