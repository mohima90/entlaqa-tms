import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { link, ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');

/**
 * "Password changed" notice (FR-IAM-13 / FR-IAM-16; T-M2-17, sent by our notification service in the
 * organization's brand — BRD v2.5 FR-NTF-02) after a reset or a My profile change. Same texts as the
 * approved notice of T-M2-08; its only link is the "forgot password" page in each language — nothing
 * that signs anyone in.
 */
export const PasswordChangedVariables = z.strictObject({
  organizationName: Localized(150),
  /** The "forgot password" page in each language. */
  forgotPasswordUrl: z.strictObject({ ar: Link, en: Link }),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type PasswordChangedVariables = z.output<typeof PasswordChangedVariables>;

function body(v: PasswordChangedVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const url = v.forgotPasswordUrl[locale];
  if (locale === 'ar') {
    return markup`<h1
        style="margin: 0 0 14px 0; font-size: ${primary ? '23px' : '18px'}; line-height: 1.5"
      >
        تغيّرت كلمة المرور
      </h1>
      ${paragraph(markup`تغيّرت كلمة المرور للحساب ${ltr(v.loginEmail)}، وأُنهيت جلسات الدخول على الأجهزة الأخرى.`)}
      ${paragraph(markup`إن لم يكن التغيير منك، يمكنك تعيين كلمة مرور جديدة الآن من صفحة ${link('نسيت كلمة المرور', url)} وإبلاغ مدير المنشأة.`)}
      ${paragraph(markup`إن كان التغيير منك، فلا حاجة إلى أي إجراء.`, true, true)}`;
  }
  return markup`<h1
      style="margin: 0 0 12px 0; font-size: ${primary ? '22px' : '17px'}; line-height: 1.4"
    >
      Your password was changed
    </h1>
    ${paragraph(markup`The password for ${v.loginEmail} was changed, and other devices were signed out.`)}
    ${paragraph(markup`If you didn't do this, set a new password now on the ${link('Forgot password', url)} page and tell your organization's administrator.`)}
    ${paragraph(markup`If it was you, there is nothing to do.`, true, true)}`;
}

function plain(v: PasswordChangedVariables, locale: AppLocale): string {
  const url = v.forgotPasswordUrl[locale];
  if (locale === 'ar') {
    return [
      'تغيّرت كلمة المرور',
      '',
      `تغيّرت كلمة المرور للحساب ${v.loginEmail}، وأُنهيت جلسات الدخول على الأجهزة الأخرى.`,
      'إن لم يكن التغيير منك، يمكنك تعيين كلمة مرور جديدة الآن من صفحة «نسيت كلمة المرور» وإبلاغ مدير المنشأة:',
      url,
      '',
      'إن كان التغيير منك، فلا حاجة إلى أي إجراء.',
    ].join('\n');
  }
  return [
    'Your password was changed',
    '',
    `The password for ${v.loginEmail} was changed, and other devices were signed out.`,
    `If you didn't do this, set a new password now on the "Forgot password" page and tell your organization's administrator:`,
    url,
    '',
    'If it was you, there is nothing to do.',
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'تغيّرت كلمة المرور · Your password was changed',
  en: 'Your password was changed · تغيّرت كلمة المرور',
};

export const passwordChangedTemplate: EmailTemplate<typeof PasswordChangedVariables> = {
  key: 'platform.password_changed',
  version: 1,
  variables: PasswordChangedVariables,
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
