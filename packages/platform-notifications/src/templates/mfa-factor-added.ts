import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { formatEmailDateTime, isTimeZone } from '../format';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { actionButton, link, ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');
/** A well-known browser or system name (platform-core describeUserAgent), never the raw user agent. */
const DeviceName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z ]{0,39}$/)
  .nullable();

/**
 * "An authenticator app was added" (FR-IAM-12; T-M2-10; security re-review N1, TM-0003 T-IAM-11): sent after
 * an authenticator app was set up for the account. It says WHEN and with WHICH browser, and its main action
 * is "Not you? Remove this app" (the link carries its token in the URL FRAGMENT, `/{ar|en}/mfa/remove#token=…`;
 * the page asks for a click; every sign-in session then ends). For the owner it carries a one-time CODE to
 * enter in the window where the app was set up: the app counts for sign-in codes and sensitive actions only
 * once that window entered it (possession of the app AND the mailbox). The code is useless anywhere else.
 */
export const MfaFactorAddedVariables = z.strictObject({
  organizationName: Localized(150),
  /** The one-time code for the window that set the app up (8 digits). */
  code: z.string().regex(/^[0-9]{8}$/, '8 digits'),
  /** When the app was set up (shown in `timeZone`) and with which browser and system (null: unknown). */
  setUpAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().refine(isTimeZone, 'IANA time zone'),
  browser: DeviceName,
  system: DeviceName,
  removeUrl: z.strictObject({ ar: Link, en: Link }),
  /** How long the code works (hours) and the removal link (days). */
  codeValidHours: z.number().int().min(1).max(168),
  removeValidDays: z.number().int().min(1).max(30),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type MfaFactorAddedVariables = z.output<typeof MfaFactorAddedVariables>;

function device(v: MfaFactorAddedVariables, locale: AppLocale): string {
  if (locale === 'ar') {
    if (v.browser && v.system) return `${v.browser} على ${v.system}`;
    return v.browser ?? v.system ?? 'متصفح غير معروف';
  }
  if (v.browser && v.system) return `${v.browser} on ${v.system}`;
  return v.browser ?? v.system ?? 'an unknown browser';
}

/** The code, large and left-to-right (also inside Arabic text), grouped for reading only. */
function codeBlock(code: string): SafeHtml {
  return markup`<p
    dir="ltr"
    style="margin: 0 0 14px 0; font-family: 'Courier New', monospace; font-size: 28px; font-weight: 700; letter-spacing: 6px; unicode-bidi: isolate"
  >
    ${code.slice(0, 4)} ${code.slice(4)}
  </p>`;
}

const TEXT = {
  ar: {
    title: 'أُضيف تطبيق مصادقة',
    remove: 'لست أنت؟ أزل هذا التطبيق',
    afterRemove: 'تُنهى عندها كل جلسات الدخول، ثم يلزم تعيين كلمة مرور جديدة وإبلاغ مدير المنشأة.',
    ifYou: 'إن كان الإعداد منك، أدخل هذا الرمز في النافذة التي أعددت فيها التطبيق:',
    never: 'لا تشارك هذا الرمز مع أحد؛ لن يطلبه منك أحد من ENTLAQA أو من منشأتك.',
  },
  en: {
    title: 'An authenticator app was added',
    remove: 'Not you? Remove this app',
    afterRemove:
      "Every sign-in session then ends; set a new password and tell your organization's administrator.",
    ifYou: 'If it was you, enter this code in the window where you set up the app:',
    never: 'Never share this code — no one at ENTLAQA or your organization will ask for it.',
  },
} as const;

function lead(v: MfaFactorAddedVariables, locale: AppLocale): string {
  const when = formatEmailDateTime(v.setUpAt, locale, v.timeZone);
  return locale === 'ar'
    ? `أُعدّ تطبيق مصادقة للحساب ${v.loginEmail} يوم ${when} من ${device(v, locale)}.`
    : `An authenticator app was set up for ${v.loginEmail} on ${when} from ${device(v, locale)}.`;
}

function validity(v: MfaFactorAddedVariables, locale: AppLocale): string {
  return locale === 'ar'
    ? `الرمز صالح لمدة ${String(v.codeValidHours)} ساعة، ولمرة واحدة، وفي تلك النافذة فقط. رابط الإزالة صالح لمدة ${String(v.removeValidDays)} أيام.`
    : `The code is valid for ${String(v.codeValidHours)} hours, once, and in that window only. The removal link is valid for ${String(v.removeValidDays)} days.`;
}

function body(v: MfaFactorAddedVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const t = TEXT[locale];
  const remove = v.removeUrl[locale];
  const when = formatEmailDateTime(v.setUpAt, locale, v.timeZone);
  const heading = primary ? (locale === 'ar' ? '23px' : '22px') : locale === 'ar' ? '18px' : '17px';
  const intro =
    locale === 'ar'
      ? markup`أُعدّ تطبيق مصادقة للحساب ${ltr(v.loginEmail)} يوم <b>${when}</b> من <b>${device(v, locale)}</b>.`
      : markup`An authenticator app was set up for ${v.loginEmail} on <b>${when}</b> from <b>${device(v, locale)}</b>.`;
  return markup`<h1 style="margin: 0 0 14px 0; font-size: ${heading}; line-height: 1.5">${t.title}</h1>
    ${paragraph(intro)}
    ${primary ? actionButton(t.remove, remove) : paragraph(link(t.remove, remove))}
    ${paragraph(markup`${t.afterRemove}`, true, true)}
    ${paragraph(markup`${t.ifYou}`)}
    ${codeBlock(v.code)}
    ${paragraph(markup`${validity(v, locale)} ${t.never}`, true, true)}`;
}

function plain(v: MfaFactorAddedVariables, locale: AppLocale): string {
  const t = TEXT[locale];
  return [
    t.title,
    '',
    lead(v, locale),
    '',
    `${t.remove}:`,
    v.removeUrl[locale],
    t.afterRemove,
    '',
    t.ifYou,
    v.code,
    validity(v, locale),
    t.never,
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'أُضيف تطبيق مصادقة إلى حسابك · An authenticator app was added',
  en: 'An authenticator app was added · أُضيف تطبيق مصادقة إلى حسابك',
};

export const mfaFactorAddedTemplate: EmailTemplate<typeof MfaFactorAddedVariables> = {
  key: 'platform.mfa_factor_added',
  // 2: the one-time code for the set-up window replaces the confirmation link (re-review N1).
  version: 2,
  variables: MfaFactorAddedVariables,
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
