import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { formatEmailDate, isTimeZone } from '../format';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { actionButton, link, ltr, paragraph, renderLayout } from '../layout';
import type { EmailTemplate } from './types';

/**
 * One line of plain text: no control characters or line/paragraph separators, and no bidirectional
 * embedding, override or isolate controls (they can make a name display as something else).
 * Joiners and direction marks used in Arabic text stay allowed.
 */
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !/[\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/u.test(v),
      'single line, plain',
    );

const Localized = (max: number) => z.strictObject({ ar: text(max), en: text(max).nullable() });

/**
 * Invitation e-mail (FR-IAM-03, approved screen 7 «رسالة الدعوة»). Names are passed in both languages
 * where known; English text falls back to the Arabic name. The inviter's name is shown in a
 * gender-neutral construction (content style guide §3).
 */
export const InvitationVariables = z.strictObject({
  recipientName: Localized(100),
  inviterName: Localized(150),
  organizationName: Localized(150),
  roleName: z.strictObject({ ar: text(100), en: text(100) }),
  acceptUrl: z.string().max(2000).refine(isSafeLink, 'https link'),
  expiresAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().refine(isTimeZone, 'IANA time zone'),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type InvitationVariables = z.output<typeof InvitationVariables>;

const PRODUCT: Readonly<Record<AppLocale, string>> = {
  ar: 'جدارات · التدريب',
  en: 'Jadarat · Training',
};

/** Footer signature (approved screen 7). */
const SIGNATURE: Readonly<Record<AppLocale, string>> = {
  ar: 'جدارات · منصة ENTLAQA',
  en: 'Jadarat · an ENTLAQA platform',
};

function name(value: { ar: string; en: string | null }, locale: AppLocale): string {
  return locale === 'ar' ? value.ar : (value.en ?? value.ar);
}

function body(v: InvitationVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const recipient = name(v.recipientName, locale);
  const inviter = name(v.inviterName, locale);
  const org = name(v.organizationName, locale);
  const role = v.roleName[locale];
  const expires = formatEmailDate(v.expiresAt, locale, v.timeZone);
  if (locale === 'ar') {
    return markup`<h1
        style="margin: 0 0 14px 0; font-size: ${primary ? '23px' : '18px'}; line-height: 1.5"
      >
        مرحبًا ${recipient}،
      </h1>
      ${paragraph(markup`لديك دعوة من <b>${inviter}</b> للانضمام إلى نظام التدريب في <b>${org}</b> بدور <b>${role}</b>.`)}
      ${paragraph(markup`لبدء الاستخدام، يمكنك قبول الدعوة واختيار كلمة مرور لحسابك.`)}
      ${primary ? actionButton('قبول الدعوة', v.acceptUrl) : paragraph(link('قبول الدعوة', v.acceptUrl))}
      ${paragraph(markup`ينتهي هذا الرابط يوم <b>${expires}</b>. إذا انتهى، يمكن طلب دعوة جديدة من مدير المنشأة.`, true, true)}
      ${paragraph(markup`اسم الدخول: ${ltr(v.loginEmail)}`, true, true)}
      ${paragraph(markup`إن كانت هذه الرسالة غير متوقعة، يمكنك تجاهلها؛ لن يُنشأ أي حساب دون قبولها.`, true, true)}`;
  }
  return markup`<h1
      style="margin: 0 0 12px 0; font-size: ${primary ? '22px' : '17px'}; line-height: 1.4"
    >
      Hello ${recipient},
    </h1>
    ${paragraph(markup`${inviter} invited you to the training system of <b>${org}</b> with the role <b>${role}</b>. Accept the invitation and choose a password to get started.`)}
    ${primary ? actionButton('Accept invitation', v.acceptUrl) : paragraph(link('Accept invitation', v.acceptUrl))}
    ${paragraph(markup`This link expires on <b>${expires}</b>. If it expires, your organization's administrator can send a new invitation.`, true, true)}
    ${paragraph(markup`Sign-in e-mail: ${v.loginEmail}`, true, true)}
    ${paragraph(markup`If you weren't expecting this e-mail, you can ignore it. No account is created unless you accept.`, true, true)}`;
}

function plain(v: InvitationVariables, locale: AppLocale): string {
  const recipient = name(v.recipientName, locale);
  const inviter = name(v.inviterName, locale);
  const org = name(v.organizationName, locale);
  const role = v.roleName[locale];
  const expires = formatEmailDate(v.expiresAt, locale, v.timeZone);
  if (locale === 'ar') {
    return [
      `مرحبًا ${recipient}،`,
      '',
      `لديك دعوة من ${inviter} للانضمام إلى نظام التدريب في ${org} بدور ${role}.`,
      'لبدء الاستخدام، يمكنك قبول الدعوة واختيار كلمة مرور لحسابك:',
      v.acceptUrl,
      '',
      `ينتهي هذا الرابط يوم ${expires}. إذا انتهى، يمكن طلب دعوة جديدة من مدير المنشأة.`,
      `اسم الدخول: ${v.loginEmail}`,
      'إن كانت هذه الرسالة غير متوقعة، يمكنك تجاهلها؛ لن يُنشأ أي حساب دون قبولها.',
    ].join('\n');
  }
  return [
    `Hello ${recipient},`,
    '',
    `${inviter} invited you to the training system of ${org} with the role ${role}.`,
    'Accept the invitation and choose a password to get started:',
    v.acceptUrl,
    '',
    `This link expires on ${expires}. If it expires, your organization's administrator can send a new invitation.`,
    `Sign-in e-mail: ${v.loginEmail}`,
    "If you weren't expecting this e-mail, you can ignore it. No account is created unless you accept.",
  ].join('\n');
}

export const invitationTemplate: EmailTemplate<typeof InvitationVariables> = {
  key: 'platform.invitation',
  version: 1,
  variables: InvitationVariables,
  render(v, primary) {
    const secondary = otherLocale(primary);
    const org = name(v.organizationName, primary);
    const subject =
      primary === 'ar'
        ? `دعوة للانضمام إلى نظام التدريب في ${org}`
        : `Invitation to join the training system of ${org}`;
    const footer = [
      {
        locale: 'ar' as const,
        content: markup`أُرسلت هذه الرسالة إلى ${ltr(v.loginEmail)} بطلب من ${v.organizationName.ar}.`,
      },
      {
        locale: 'en' as const,
        content: markup`Sent to ${v.loginEmail} at the request of ${name(v.organizationName, 'en')}.`,
      },
      { locale: primary, content: markup`${SIGNATURE[primary]}` },
    ];
    const htmlBody = renderLayout({
      title: subject,
      organizationName: org,
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
      `أُرسلت هذه الرسالة إلى ${v.loginEmail} بطلب من ${v.organizationName.ar}.`,
      `Sent to ${v.loginEmail} at the request of ${name(v.organizationName, 'en')}.`,
    ].join('\n');
    return { subject, html: htmlBody, text: textBody };
  },
};
