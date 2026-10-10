import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { link, ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');

/**
 * "Sign-in to your account was unlocked" (T-M2-11, FR-IAM-13; security review M1): sent by our
 * notification service every time an Organization Admin ends the pause on a member's sign-in («إلغاء
 * إيقاف تسجيل الدخول» on the profile), so an unlock the person did not ask for — a mistaken or abused admin
 * session — does not go unnoticed. It names the organization, never the administrator; its only link is
 * the "forgot password" page in each language — nothing that signs anyone in. Arabic copy to be confirmed
 * by the UX writer (docs/design/content/glossary-ar-en.md: «مدير المنشأة», «نسيت كلمة المرور»).
 */
export const SignInUnlockedVariables = z.strictObject({
  organizationName: Localized(150),
  /** The "forgot password" page in each language. */
  forgotPasswordUrl: z.strictObject({ ar: Link, en: Link }),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type SignInUnlockedVariables = z.output<typeof SignInUnlockedVariables>;

function body(v: SignInUnlockedVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const url = v.forgotPasswordUrl[locale];
  const organization = localizedName(v.organizationName, locale);
  if (locale === 'ar') {
    return markup`<h1
        style="margin: 0 0 14px 0; font-size: ${primary ? '23px' : '18px'}; line-height: 1.5"
      >
        أُلغي إيقاف تسجيل الدخول إلى حسابك
      </h1>
      ${paragraph(markup`كان تسجيل الدخول إلى الحساب ${ltr(v.loginEmail)} موقوفًا مؤقتًا بعد عدة محاولات لم تنجح، وقد ألغى مدير المنشأة في ${organization} هذا الإيقاف. يمكنك تسجيل الدخول الآن.`)}
      ${paragraph(markup`إن لم تكن المحاولات منك أو لم تطلب إلغاء الإيقاف، فعيّن كلمة مرور جديدة الآن من صفحة ${link('نسيت كلمة المرور', url)} وأبلغ مدير المنشأة.`)}
      ${paragraph(markup`إن كنت تعرف سبب الإيقاف، فلا حاجة إلى أي إجراء.`, true, true)}`;
  }
  return markup`<h1
      style="margin: 0 0 12px 0; font-size: ${primary ? '22px' : '17px'}; line-height: 1.4"
    >
      Sign-in to your account was unlocked
    </h1>
    ${paragraph(markup`Sign-in to ${v.loginEmail} was paused after several unsuccessful attempts, and an administrator of ${organization} has ended the pause. You can sign in now.`)}
    ${paragraph(markup`If the attempts weren't yours, or you didn't ask for this, set a new password now on the ${link('Forgot password', url)} page and tell your organization's administrator.`)}
    ${paragraph(markup`If you know why sign-in was paused, there is nothing to do.`, true, true)}`;
}

function plain(v: SignInUnlockedVariables, locale: AppLocale): string {
  const url = v.forgotPasswordUrl[locale];
  const organization = localizedName(v.organizationName, locale);
  if (locale === 'ar') {
    return [
      'أُلغي إيقاف تسجيل الدخول إلى حسابك',
      '',
      `كان تسجيل الدخول إلى الحساب ${v.loginEmail} موقوفًا مؤقتًا بعد عدة محاولات لم تنجح، وقد ألغى مدير المنشأة في ${organization} هذا الإيقاف. يمكنك تسجيل الدخول الآن.`,
      'إن لم تكن المحاولات منك أو لم تطلب إلغاء الإيقاف، فعيّن كلمة مرور جديدة الآن من صفحة «نسيت كلمة المرور» وأبلغ مدير المنشأة:',
      url,
      '',
      'إن كنت تعرف سبب الإيقاف، فلا حاجة إلى أي إجراء.',
    ].join('\n');
  }
  return [
    'Sign-in to your account was unlocked',
    '',
    `Sign-in to ${v.loginEmail} was paused after several unsuccessful attempts, and an administrator of ${organization} has ended the pause. You can sign in now.`,
    `If the attempts weren't yours, or you didn't ask for this, set a new password now on the "Forgot password" page and tell your organization's administrator:`,
    url,
    '',
    'If you know why sign-in was paused, there is nothing to do.',
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'أُلغي إيقاف تسجيل الدخول إلى حسابك · Sign-in to your account was unlocked',
  en: 'Sign-in to your account was unlocked · أُلغي إيقاف تسجيل الدخول إلى حسابك',
};

export const signInUnlockedTemplate: EmailTemplate<typeof SignInUnlockedVariables> = {
  key: 'platform.sign_in_unlocked',
  version: 1,
  variables: SignInUnlockedVariables,
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
