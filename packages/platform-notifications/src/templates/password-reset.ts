import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { actionButton, link, ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');

/**
 * Password-reset e-mail (FR-IAM-13, screen 10 → 11; T-M2-17, sent by our notification service in the
 * organization's brand — BRD v2.5 FR-NTF-02). Same texts as the approved reset e-mail of T-M2-08, layout
 * of the invitation e-mail (screen 7): the primary language first with the button, the other below with
 * a plain link to the same page in that language. The links carry the token in the URL FRAGMENT
 * (`/{ar|en}/reset-password#token_hash=…&type=recovery`); the e-mail never carries the one-time code or
 * Auth's own /verify link, and the links appear only in the button / plain link and in the text part.
 */
export const PasswordResetVariables = z.strictObject({
  organizationName: Localized(150),
  /** The reset page in each language (the worker builds both from the same token). */
  resetUrl: z.strictObject({ ar: Link, en: Link }),
  /** How long the link works (Auth's `otp_exp`: 60 minutes). */
  validMinutes: z.number().int().min(1).max(1440),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type PasswordResetVariables = z.output<typeof PasswordResetVariables>;

function body(v: PasswordResetVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const url = v.resetUrl[locale];
  if (locale === 'ar') {
    return markup`<h1
        style="margin: 0 0 14px 0; font-size: ${primary ? '23px' : '18px'}; line-height: 1.5"
      >
        إعادة تعيين كلمة المرور
      </h1>
      ${paragraph(markup`وصلنا طلب لتعيين كلمة مرور جديدة للحساب ${ltr(v.loginEmail)}.`)}
      ${primary ? actionButton('تعيين كلمة مرور جديدة', url) : paragraph(link('تعيين كلمة مرور جديدة', url))}
      ${paragraph(markup`الرابط صالح لمدة <b>${v.validMinutes} دقيقة</b> ويُستخدم مرة واحدة. إذا انتهى، يمكن طلب رابط جديد من صفحة «نسيت كلمة المرور».`, true, true)}
      ${paragraph(markup`إن لم يكن الطلب منك، يمكنك تجاهل هذه الرسالة؛ تبقى كلمة المرور الحالية كما هي.`, true, true)}`;
  }
  return markup`<h1
      style="margin: 0 0 12px 0; font-size: ${primary ? '22px' : '17px'}; line-height: 1.4"
    >
      Reset your password
    </h1>
    ${paragraph(markup`We received a request to set a new password for ${v.loginEmail}.`)}
    ${primary ? actionButton('Set a new password', url) : paragraph(link('Set a new password', url))}
    ${paragraph(markup`The link is valid for <b>${v.validMinutes} minutes</b> and works once. If it has expired, request a new one on the "Forgot password" page.`, true, true)}
    ${paragraph(markup`If you didn't ask for this, you can ignore this e-mail; your current password stays as it is.`, true, true)}`;
}

function plain(v: PasswordResetVariables, locale: AppLocale): string {
  const url = v.resetUrl[locale];
  if (locale === 'ar') {
    return [
      'إعادة تعيين كلمة المرور',
      '',
      `وصلنا طلب لتعيين كلمة مرور جديدة للحساب ${v.loginEmail}.`,
      'تعيين كلمة مرور جديدة:',
      url,
      '',
      `الرابط صالح لمدة ${String(v.validMinutes)} دقيقة ويُستخدم مرة واحدة. إذا انتهى، يمكن طلب رابط جديد من صفحة «نسيت كلمة المرور».`,
      'إن لم يكن الطلب منك، يمكنك تجاهل هذه الرسالة؛ تبقى كلمة المرور الحالية كما هي.',
    ].join('\n');
  }
  return [
    'Reset your password',
    '',
    `We received a request to set a new password for ${v.loginEmail}.`,
    'Set a new password:',
    url,
    '',
    `The link is valid for ${String(v.validMinutes)} minutes and works once. If it has expired, request a new one on the "Forgot password" page.`,
    "If you didn't ask for this, you can ignore this e-mail; your current password stays as it is.",
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'إعادة تعيين كلمة المرور · Reset your password',
  en: 'Reset your password · إعادة تعيين كلمة المرور',
};

export const passwordResetTemplate: EmailTemplate<typeof PasswordResetVariables> = {
  key: 'platform.password_reset',
  version: 1,
  variables: PasswordResetVariables,
  render(v, primary) {
    const secondary = otherLocale(primary);
    const footer = [
      {
        locale: 'ar' as const,
        content: markup`أُرسلت هذه الرسالة إلى ${ltr(v.loginEmail)} بطلب من صفحة «نسيت كلمة المرور».`,
      },
      {
        locale: 'en' as const,
        content: markup`Sent to ${v.loginEmail} because a password reset was requested.`,
      },
      { locale: primary, content: markup`${SIGNATURE[primary]}` },
    ];
    const subject = SUBJECT[primary];
    const html = renderLayout({
      title: subject,
      organizationName: localizedName(v.organizationName, primary),
      productLabel: PRODUCT[primary],
      primary: { locale: primary, content: body(v, primary, true) },
      secondary: { locale: secondary, content: body(v, secondary, false) },
      footer,
    });
    const textBody = [
      plain(v, primary),
      '',
      '———',
      '',
      plain(v, secondary),
      '',
      '———',
      `أُرسلت هذه الرسالة إلى ${v.loginEmail} بطلب من صفحة «نسيت كلمة المرور».`,
      `Sent to ${v.loginEmail} because a password reset was requested.`,
    ].join('\n');
    return { subject, html, text: textBody };
  },
};
