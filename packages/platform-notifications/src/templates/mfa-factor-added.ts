import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { actionButton, link, ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');

/**
 * "Confirm your authenticator app" (FR-IAM-12; T-M2-10; security review H1, TM-0003 T-IAM-11): sent after an
 * authenticator app was set up for the account. The app counts for sensitive actions and sign-in codes only
 * once the account opens the CONFIRMATION link (the mailbox is proved); the "not you?" link removes it and
 * signs every device out. Both links carry their token in the URL FRAGMENT (`/{ar|en}/mfa/confirm#token=…`,
 * `/{ar|en}/mfa/remove#token=…`); the pages ask for a click before anything changes.
 */
export const MfaFactorAddedVariables = z.strictObject({
  organizationName: Localized(150),
  confirmUrl: z.strictObject({ ar: Link, en: Link }),
  removeUrl: z.strictObject({ ar: Link, en: Link }),
  /** How long the confirmation link works (hours) and the removal link (days). */
  confirmValidHours: z.number().int().min(1).max(168),
  removeValidDays: z.number().int().min(1).max(30),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type MfaFactorAddedVariables = z.output<typeof MfaFactorAddedVariables>;

function body(v: MfaFactorAddedVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const confirm = v.confirmUrl[locale];
  const remove = v.removeUrl[locale];
  if (locale === 'ar') {
    return markup`<h1
        style="margin: 0 0 14px 0; font-size: ${primary ? '23px' : '18px'}; line-height: 1.5"
      >
        تأكيد تطبيق المصادقة
      </h1>
      ${paragraph(markup`أُعدّ تطبيق مصادقة للحساب ${ltr(v.loginEmail)}. يلزم تأكيده من هنا قبل أن تُقبل رموزه للدخول والإجراءات الحساسة.`)}
      ${primary ? actionButton('تأكيد التطبيق', confirm) : paragraph(link('تأكيد التطبيق', confirm))}
      ${paragraph(markup`رابط التأكيد صالح لمدة <b>${v.confirmValidHours} ساعة</b> ويُستخدم مرة واحدة.`, true, true)}
      ${paragraph(markup`إن لم يكن الإعداد منك، يمكنك ${link('إزالة هذا التطبيق', remove)}؛ تُنهى عندها كل جلسات الدخول، ثم يلزم تعيين كلمة مرور جديدة وإبلاغ مدير المنشأة.`)}`;
  }
  return markup`<h1
      style="margin: 0 0 12px 0; font-size: ${primary ? '22px' : '17px'}; line-height: 1.4"
    >
      Confirm your authenticator app
    </h1>
    ${paragraph(markup`An authenticator app was set up for ${v.loginEmail}. Confirm it here before its codes are accepted for sign-in and sensitive actions.`)}
    ${primary ? actionButton('Confirm the app', confirm) : paragraph(link('Confirm the app', confirm))}
    ${paragraph(markup`The confirmation link is valid for <b>${v.confirmValidHours} hours</b> and works once.`, true, true)}
    ${paragraph(markup`If you didn't set it up, ${link('remove this app', remove)}. Every sign-in session then ends; set a new password and tell your organization's administrator.`)}`;
}

function plain(v: MfaFactorAddedVariables, locale: AppLocale): string {
  if (locale === 'ar') {
    return [
      'تأكيد تطبيق المصادقة',
      '',
      `أُعدّ تطبيق مصادقة للحساب ${v.loginEmail}. يلزم تأكيده من هنا قبل أن تُقبل رموزه للدخول والإجراءات الحساسة:`,
      v.confirmUrl.ar,
      `رابط التأكيد صالح لمدة ${String(v.confirmValidHours)} ساعة ويُستخدم مرة واحدة.`,
      '',
      'إن لم يكن الإعداد منك، يمكنك إزالة هذا التطبيق من الرابط التالي؛ تُنهى عندها كل جلسات الدخول، ثم يلزم تعيين كلمة مرور جديدة وإبلاغ مدير المنشأة:',
      v.removeUrl.ar,
    ].join('\n');
  }
  return [
    'Confirm your authenticator app',
    '',
    `An authenticator app was set up for ${v.loginEmail}. Confirm it here before its codes are accepted for sign-in and sensitive actions:`,
    v.confirmUrl.en,
    `The confirmation link is valid for ${String(v.confirmValidHours)} hours and works once.`,
    '',
    "If you didn't set it up, remove this app with the link below. Every sign-in session then ends; set a new password and tell your organization's administrator:",
    v.removeUrl.en,
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'تأكيد تطبيق المصادقة · Confirm your authenticator app',
  en: 'Confirm your authenticator app · تأكيد تطبيق المصادقة',
};

export const mfaFactorAddedTemplate: EmailTemplate<typeof MfaFactorAddedVariables> = {
  key: 'platform.mfa_factor_added',
  version: 1,
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
