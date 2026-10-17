import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { type SafeHtml, markup } from '../html';
import { ltr, paragraph, renderLayout } from '../layout';
import { EMAIL_PROVIDERS } from '../providers';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

/** Provider names as the settings pages show them (product names: not translated). */
const PROVIDER_NAMES: Readonly<Record<(typeof EMAIL_PROVIDERS)[number], string>> = {
  resend: 'Resend',
  smtp: 'SMTP',
  sendgrid: 'SendGrid',
  mailgun: 'Mailgun',
  microsoft_graph: 'Microsoft 365',
};

/**
 * The test e-mail of a sender's settings (WP-ADM-01; Kawadir's «Save & send test»): sent by the worker
 * through exactly the settings being tested — the platform sender (Super Admin) or an organization's own
 * provider (Organization Admin) — to the address the admin chose. A sender becomes verified only once it went
 * out. No link, no personal data beyond the sender's own address. Arabic copy to be confirmed by the UX
 * writer (docs/design/content/glossary-ar-en.md: «البريد الإلكتروني», «المرسِل»).
 */
export const EmailTestVariables = z.strictObject({
  /** The organization (Email integration) or the platform («جدارات» / Jadarat). */
  senderOwner: Localized(150),
  provider: z.enum(EMAIL_PROVIDERS),
  fromAddress: z.string().max(254),
});

export type EmailTestVariables = z.output<typeof EmailTestVariables>;

function body(v: EmailTestVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const owner = localizedName(v.senderOwner, locale);
  const provider = PROVIDER_NAMES[v.provider];
  if (locale === 'ar') {
    return markup`<h1
        style="margin: 0 0 14px 0; font-size: ${primary ? '23px' : '18px'}; line-height: 1.5"
      >
        إعدادات إرسال البريد تعمل
      </h1>
      ${paragraph(markup`هذه رسالة تجريبية من إعدادات البريد الإلكتروني في ${owner}، أُرسلت من ${ltr(v.fromAddress)} عبر ${ltr(provider)}.`)}
      ${paragraph(markup`وصول هذه الرسالة يعني أن المرسِل جاهز، ولا حاجة إلى أي إجراء.`, true, true)}`;
  }
  return markup`<h1
      style="margin: 0 0 12px 0; font-size: ${primary ? '22px' : '17px'}; line-height: 1.4"
    >
      Your e-mail sending settings work
    </h1>
    ${paragraph(markup`This is a test message from the e-mail settings of ${owner}, sent from ${v.fromAddress} through ${provider}.`)}
    ${paragraph(markup`If you received it, the sender is ready. There is nothing else to do.`, true, true)}`;
}

function plain(v: EmailTestVariables, locale: AppLocale): string {
  const owner = localizedName(v.senderOwner, locale);
  const provider = PROVIDER_NAMES[v.provider];
  if (locale === 'ar') {
    return [
      'إعدادات إرسال البريد تعمل',
      '',
      `هذه رسالة تجريبية من إعدادات البريد الإلكتروني في ${owner}، أُرسلت من ${v.fromAddress} عبر ${provider}.`,
      'وصول هذه الرسالة يعني أن المرسِل جاهز، ولا حاجة إلى أي إجراء.',
    ].join('\n');
  }
  return [
    'Your e-mail sending settings work',
    '',
    `This is a test message from the e-mail settings of ${owner}, sent from ${v.fromAddress} through ${provider}.`,
    'If you received it, the sender is ready. There is nothing else to do.',
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'رسالة تجريبية · Test message',
  en: 'Test message · رسالة تجريبية',
};

export const emailTestTemplate: EmailTemplate<typeof EmailTestVariables> = {
  key: 'platform.email_test',
  version: 1,
  variables: EmailTestVariables,
  render(v, primary) {
    const secondary = otherLocale(primary);
    const subject = SUBJECT[primary];
    const html = renderLayout({
      title: subject,
      organizationName: localizedName(v.senderOwner, primary),
      productLabel: PRODUCT[primary],
      primary: { locale: primary, content: body(v, primary, true) },
      secondary: { locale: secondary, content: body(v, secondary, false) },
      footer: [
        { locale: 'ar', content: markup`رسالة تجريبية لإعدادات البريد الإلكتروني.` },
        { locale: 'en', content: markup`Test of the e-mail settings.` },
        { locale: primary, content: markup`${SIGNATURE[primary]}` },
      ],
    });
    const textBody = [plain(v, primary), '', '———', '', plain(v, secondary)].join('\n');
    return { subject, html, text: textBody };
  },
};
