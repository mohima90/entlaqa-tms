import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { actionButton, link, ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');

/**
 * "Sign-in to your account was paused" (PO decision 9 Oct 2026; T-M2-11, FR-IAM-13): sent by our
 * notification service when repeated failed attempts lock an account (or use up the budget of a browser
 * the account trusts). It says what happened, that the lock lifts by itself after `lockMinutes`, that
 * browsers remembered with «تذكّر هذا المتصفح» still sign in, that setting a new password (the "forgot
 * password" page — nothing that signs anyone in) ends the pause at once and keeps the browser used for it
 * remembered while the others must sign in again (security review M2), to tell the Organization Admin when
 * the attempts were not the person's, and that we send this at most once a day (security review M3).
 * Arabic copy to be confirmed by the UX writer (docs/design/content/glossary-ar-en.md: «مدير المنشأة»,
 * «كلمة المرور», «نسيت كلمة المرور»).
 */
export const AccountLockedVariables = z.strictObject({
  organizationName: Localized(150),
  /** How long the lock lasts (minutes). */
  lockMinutes: z.number().int().min(1).max(1440),
  /** The "forgot password" page in each language. */
  forgotPasswordUrl: z.strictObject({ ar: Link, en: Link }),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type AccountLockedVariables = z.output<typeof AccountLockedVariables>;

/** Minutes in Arabic with the counted noun's agreement (1, 2, 3–10, 11+). */
export function arabicMinutes(minutes: number): string {
  if (minutes === 1) return 'دقيقة واحدة';
  if (minutes === 2) return 'دقيقتين';
  const lastTwo = minutes % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return `${String(minutes)} دقائق`;
  return `${String(minutes)} دقيقة`;
}

function englishMinutes(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
}

function body(v: AccountLockedVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const url = v.forgotPasswordUrl[locale];
  if (locale === 'ar') {
    return markup`<h1
        style="margin: 0 0 14px 0; font-size: ${primary ? '23px' : '18px'}; line-height: 1.5"
      >
        أُوقف تسجيل الدخول إلى حسابك مؤقتًا
      </h1>
      ${paragraph(markup`بعد عدة محاولات لم تنجح لتسجيل الدخول إلى الحساب ${ltr(v.loginEmail)}، أوقفنا تسجيل الدخول إليه مؤقتًا.`)}
      ${paragraph(markup`يُرفع الإيقاف تلقائيًا بعد <b>${arabicMinutes(v.lockMinutes)}</b>. ويبقى بإمكانك الدخول من المتصفحات التي اخترت فيها «تذكّر هذا المتصفح».`)}
      ${primary ? actionButton('تعيين كلمة مرور جديدة', url) : paragraph(link('تعيين كلمة مرور جديدة', url))}
      ${paragraph(markup`تعيين كلمة مرور جديدة يُنهي الإيقاف فورًا، ويتذكّر المتصفح الذي تستخدمه لذلك، أما المتصفحات الأخرى فيلزمها تسجيل الدخول من جديد.`)}
      ${paragraph(markup`إن لم تكن هذه المحاولات منك، فعيّن كلمة مرور جديدة وأبلغ مدير المنشأة.`, true, true)}
      ${paragraph(markup`نرسل هذا التنبيه مرة واحدة في اليوم على الأكثر.`, true, true)}`;
  }
  return markup`<h1
      style="margin: 0 0 12px 0; font-size: ${primary ? '22px' : '17px'}; line-height: 1.4"
    >
      Sign-in to your account was paused
    </h1>
    ${paragraph(markup`After several unsuccessful attempts to sign in to ${v.loginEmail}, we paused sign-in to this account for now.`)}
    ${paragraph(markup`The pause ends by itself after <b>${englishMinutes(v.lockMinutes)}</b>. Browsers where you chose “Remember this browser” can still sign in.`)}
    ${primary ? actionButton('Set a new password', url) : paragraph(link('Set a new password', url))}
    ${paragraph(markup`Setting a new password ends the pause at once. The browser you use for it is remembered; other browsers need to sign in again.`)}
    ${paragraph(markup`If these attempts weren't yours, set a new password and tell your organization's administrator.`, true, true)}
    ${paragraph(markup`We send this notice at most once a day.`, true, true)}`;
}

function plain(v: AccountLockedVariables, locale: AppLocale): string {
  const url = v.forgotPasswordUrl[locale];
  if (locale === 'ar') {
    return [
      'أُوقف تسجيل الدخول إلى حسابك مؤقتًا',
      '',
      `بعد عدة محاولات لم تنجح لتسجيل الدخول إلى الحساب ${v.loginEmail}، أوقفنا تسجيل الدخول إليه مؤقتًا.`,
      `يُرفع الإيقاف تلقائيًا بعد ${arabicMinutes(v.lockMinutes)}. ويبقى بإمكانك الدخول من المتصفحات التي اخترت فيها «تذكّر هذا المتصفح».`,
      'تعيين كلمة مرور جديدة:',
      url,
      'تعيين كلمة مرور جديدة يُنهي الإيقاف فورًا، ويتذكّر المتصفح الذي تستخدمه لذلك، أما المتصفحات الأخرى فيلزمها تسجيل الدخول من جديد.',
      '',
      'إن لم تكن هذه المحاولات منك، فعيّن كلمة مرور جديدة وأبلغ مدير المنشأة.',
      'نرسل هذا التنبيه مرة واحدة في اليوم على الأكثر.',
    ].join('\n');
  }
  return [
    'Sign-in to your account was paused',
    '',
    `After several unsuccessful attempts to sign in to ${v.loginEmail}, we paused sign-in to this account for now.`,
    `The pause ends by itself after ${englishMinutes(v.lockMinutes)}. Browsers where you chose “Remember this browser” can still sign in.`,
    'Set a new password:',
    url,
    'Setting a new password ends the pause at once. The browser you use for it is remembered; other browsers need to sign in again.',
    '',
    `If these attempts weren't yours, set a new password and tell your organization's administrator.`,
    'We send this notice at most once a day.',
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'أُوقف تسجيل الدخول إلى حسابك مؤقتًا · Sign-in to your account was paused',
  en: 'Sign-in to your account was paused · أُوقف تسجيل الدخول إلى حسابك مؤقتًا',
};

export const accountLockedTemplate: EmailTemplate<typeof AccountLockedVariables> = {
  key: 'platform.account_locked',
  version: 1,
  variables: AccountLockedVariables,
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
