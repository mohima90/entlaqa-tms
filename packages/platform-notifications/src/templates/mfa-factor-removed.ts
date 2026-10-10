import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { link, ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');

/**
 * "Authenticator app removed" (FR-IAM-12; T-M2-10; TM-0003 T-IAM-10/11): every removal or reset of an
 * account's authenticator app is e-mailed — by the account itself (My profile, or its own set-up cancelled),
 * as "not you" (the set-up e-mail's link, or "an app was added from another sign-in" → Remove), by an
 * Organization Admin, by ENTLAQA support after an identity check, because nobody entered the e-mailed code
 * within 72 hours (re-review N2), or after 15 wrong e-mailed codes on the account in 24 hours (final re-review
 * L2). Its only link is the "forgot password" page in each language — nothing that
 * signs anyone in.
 */
export const MFA_REMOVAL_REASONS = [
  'removed',
  'not_me',
  'admin_reset',
  'support_reset',
  'expired',
  'too_many_codes',
] as const;
type Reason = (typeof MFA_REMOVAL_REASONS)[number];

export const MfaFactorRemovedVariables = z.strictObject({
  organizationName: Localized(150),
  reason: z.enum(MFA_REMOVAL_REASONS),
  forgotPasswordUrl: z.strictObject({ ar: Link, en: Link }),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type MfaFactorRemovedVariables = z.output<typeof MfaFactorRemovedVariables>;

/** The first sentence (before the address). */
const LEAD: Readonly<Record<AppLocale, Readonly<Record<Reason, string>>>> = {
  ar: {
    removed: 'أُزيل تطبيق المصادقة من الحساب',
    not_me: 'بناءً على طلبك، أُزيل تطبيق المصادقة الذي أُعدّ للتو من الحساب',
    admin_reset: 'أعاد مدير المنشأة ضبط تطبيق المصادقة للحساب',
    support_reset: 'أعاد دعم ENTLAQA ضبط تطبيق المصادقة للحساب بعد التحقق من الهوية',
    expired: 'أُزيل تطبيق مصادقة لم يُدخَل رمز تأكيده خلال 72 ساعة من الحساب',
    too_many_codes:
      'بعد إدخال رموز تأكيد خاطئة كثيرة، أُزيل تطبيق المصادقة الذي ينتظر التأكيد من الحساب',
  },
  en: {
    removed: 'The authenticator app was removed from',
    not_me: 'As you asked, the authenticator app that was just set up was removed from',
    admin_reset: "Your organization's administrator reset the authenticator app of",
    support_reset: 'After checking your identity, ENTLAQA support reset the authenticator app of',
    expired:
      'An authenticator app whose e-mailed code was not entered within 72 hours was removed from',
    too_many_codes:
      'After many wrong confirmation codes, the authenticator app waiting to be confirmed was removed from',
  },
};

const RESET_AR =
  'أُنهيت كل جلسات الدخول، ويُطلب إعداد تطبيق من جديد عند الدخول التالي. إن لم تطلب ذلك، يمكنك تعيين كلمة مرور جديدة من صفحة ';
const RESET_EN =
  "Every sign-in session has ended; you will set up an app again at your next sign-in. If you didn't ask for this, set a new password on the ";

/** The second sentence, around the "forgot password" link. */
const AROUND: Readonly<Record<AppLocale, Readonly<Record<Reason, readonly [string, string]>>>> = {
  ar: {
    removed: [
      'إن لم يكن ذلك منك، يمكنك تعيين كلمة مرور جديدة الآن من صفحة ',
      ' وإبلاغ مدير المنشأة.',
    ],
    not_me: [
      'أُنهيت كل جلسات الدخول. يلزم الآن تعيين كلمة مرور جديدة من صفحة ',
      ' وإبلاغ مدير المنشأة.',
    ],
    admin_reset: [RESET_AR, ' وإبلاغ مدير المنشأة.'],
    support_reset: [RESET_AR, ' وإبلاغ مدير المنشأة.'],
    expired: [
      'أُنهيت جلسات الدخول التي استخدمته. إن كان منك، يمكنك إعداده من جديد. وإن لم يكن منك، يلزم تعيين كلمة مرور جديدة من صفحة ',
      ' وإبلاغ مدير المنشأة.',
    ],
    too_many_codes: [
      'أُنهيت جلسات الدخول التي أعدّته. إن كان منك، يمكنك إعداده من جديد بعد قليل. وإن لم يكن منك، فربما يعرف شخص آخر كلمة مرورك: يلزم تعيين كلمة مرور جديدة من صفحة ',
      ' وإبلاغ مدير المنشأة.',
    ],
  },
  en: {
    removed: [
      "If you didn't do this, set a new password now on the ",
      " page and tell your organization's administrator.",
    ],
    not_me: [
      'Every sign-in session has ended. Now set a new password on the ',
      " page and tell your organization's administrator.",
    ],
    admin_reset: [RESET_EN, " page and tell your organization's administrator."],
    support_reset: [RESET_EN, " page and tell your organization's administrator."],
    expired: [
      "The sign-in sessions that used it have ended. If it was you, set it up again. If it wasn't, set a new password on the ",
      " page and tell your organization's administrator.",
    ],
    too_many_codes: [
      "The sign-in sessions that set it up have ended. If it was you, set it up again a little later. If it wasn't, someone may know your password: set a new one on the ",
      " page and tell your organization's administrator.",
    ],
  },
};

function body(v: MfaFactorRemovedVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const url = v.forgotPasswordUrl[locale];
  const [before, after] = AROUND[locale][v.reason];
  if (locale === 'ar') {
    return markup`<h1
        style="margin: 0 0 14px 0; font-size: ${primary ? '23px' : '18px'}; line-height: 1.5"
      >
        أُزيل تطبيق المصادقة
      </h1>
      ${paragraph(markup`${LEAD.ar[v.reason]} ${ltr(v.loginEmail)}.`)}
      ${paragraph(markup`${before}${link('نسيت كلمة المرور', url)}${after}`)}`;
  }
  return markup`<h1
      style="margin: 0 0 12px 0; font-size: ${primary ? '22px' : '17px'}; line-height: 1.4"
    >
      Authenticator app removed
    </h1>
    ${paragraph(markup`${LEAD.en[v.reason]} ${v.loginEmail}.`)}
    ${paragraph(markup`${before}${link('Forgot password', url)}${after}`)}`;
}

function plain(v: MfaFactorRemovedVariables, locale: AppLocale): string {
  const [before, after] = AROUND[locale][v.reason];
  if (locale === 'ar') {
    return [
      'أُزيل تطبيق المصادقة',
      '',
      `${LEAD.ar[v.reason]} ${v.loginEmail}.`,
      `${before}«نسيت كلمة المرور»${after}`,
      v.forgotPasswordUrl.ar,
    ].join('\n');
  }
  return [
    'Authenticator app removed',
    '',
    `${LEAD.en[v.reason]} ${v.loginEmail}.`,
    `${before}"Forgot password"${after}`,
    v.forgotPasswordUrl.en,
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'أُزيل تطبيق المصادقة · Authenticator app removed',
  en: 'Authenticator app removed · أُزيل تطبيق المصادقة',
};

export const mfaFactorRemovedTemplate: EmailTemplate<typeof MfaFactorRemovedVariables> = {
  key: 'platform.mfa_factor_removed',
  version: 1,
  variables: MfaFactorRemovedVariables,
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
