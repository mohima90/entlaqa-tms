import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { type SafeHtml, markup } from '../html';
import { ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

/**
 * The sign-in code (WP-ADM-05, FR-IAM-12; business flow EP-AUTH-signin-extras, PO 23 Oct 2026): «Email me a
 * code» is a second way to sign in INSTEAD of the password, so this e-mail says what the code opens and that
 * nobody can use it without the mailbox. Sent through the organization's own e-mail sender when it has one,
 * otherwise the platform's, in the organization's look and both languages (the person's language first). The
 * code is shown large, left-to-right and selectable; it is NOT in the subject (lock-screen previews). It works
 * once, for `validMinutes`, and only the newest code works. The delivery log removes this content as soon as
 * the message is final (docs/engineering/email.md).
 */
export const SignInCodeVariables = z.strictObject({
  organizationName: Localized(150),
  /** The six digits. */
  code: z.string().regex(/^[0-9]{6}$/, '6 digits'),
  /** How long it works (10 minutes). */
  validMinutes: z.number().int().min(1).max(60),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type SignInCodeVariables = z.output<typeof SignInCodeVariables>;

/** The code, large and left-to-right (also inside Arabic text), grouped for reading only. */
function codeBlock(code: string): SafeHtml {
  return markup`<p
    dir="ltr"
    style="margin: 0 0 14px 0; font-family: 'Courier New', monospace; font-size: 30px; font-weight: 700; letter-spacing: 8px; unicode-bidi: isolate"
  >
    ${code.slice(0, 3)} ${code.slice(3)}
  </p>`;
}

const TEXT = {
  ar: {
    title: 'رمز تسجيل الدخول',
    lead: 'استخدم هذا الرمز لإكمال تسجيل الدخول إلى',
    ignore: 'لم تحاول تسجيل الدخول؟ يمكنك تجاهل هذه الرسالة؛ حسابك آمن ما دام الرمز ليس مع أحد.',
    never: 'لا نطلب منك هذا الرمز أبدًا عبر الهاتف أو المحادثة أو البريد.',
  },
  en: {
    title: 'Your sign-in code',
    lead: 'Use this code to finish signing in to',
    ignore:
      "Didn't try to sign in? You can ignore this e-mail. Your account is safe while nobody has this code.",
    never: 'We never ask you for this code by phone, chat or e-mail.',
  },
} as const;

function validity(v: SignInCodeVariables, locale: AppLocale): string {
  return locale === 'ar'
    ? `يعمل لمدة ${String(v.validMinutes)} دقائق ولمرة واحدة فقط، ولا يعمل إلا أحدث رمز.`
    : `It works for ${String(v.validMinutes)} minutes and only once. Only the newest code works.`;
}

function body(v: SignInCodeVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const t = TEXT[locale];
  const heading = primary ? (locale === 'ar' ? '23px' : '22px') : locale === 'ar' ? '18px' : '17px';
  const name = localizedName(v.organizationName, locale);
  return markup`<h1 style="margin: 0 0 14px 0; font-size: ${heading}; line-height: 1.5">${t.title}</h1>
    ${paragraph(markup`${t.lead} <b>${name}</b> (${ltr(v.loginEmail)}).`)}
    ${codeBlock(v.code)}
    ${paragraph(markup`${validity(v, locale)}`, true, true)}
    ${paragraph(markup`${t.ignore}`, true, true)}
    ${paragraph(markup`${t.never}`, true, true)}`;
}

function plain(v: SignInCodeVariables, locale: AppLocale): string {
  const t = TEXT[locale];
  return [
    t.title,
    '',
    `${t.lead} ${localizedName(v.organizationName, locale)} (${v.loginEmail}):`,
    '',
    v.code,
    '',
    validity(v, locale),
    t.ignore,
    t.never,
  ].join('\n');
}

// No code in the subject: it would show on lock screens and in notification previews.
const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'رمز تسجيل الدخول · Your sign-in code',
  en: 'Your sign-in code · رمز تسجيل الدخول',
};

export const signInCodeTemplate: EmailTemplate<typeof SignInCodeVariables> = {
  key: 'platform.sign_in_code',
  version: 1,
  variables: SignInCodeVariables,
  render(v, primary) {
    const secondary = otherLocale(primary);
    const footer = [
      {
        locale: 'ar' as const,
        content: markup`أُرسلت هذه الرسالة إلى ${ltr(v.loginEmail)} لأن أحدًا طلب رمز تسجيل الدخول.`,
      },
      {
        locale: 'en' as const,
        content: markup`Sent to ${v.loginEmail} because a sign-in code was requested.`,
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
    const text = [
      plain(v, primary),
      '',
      '———',
      '',
      plain(v, secondary),
      '',
      '———',
      `أُرسلت هذه الرسالة إلى ${v.loginEmail} لأن أحدًا طلب رمز تسجيل الدخول.`,
      `Sent to ${v.loginEmail} because a sign-in code was requested.`,
    ].join('\n');
    return { subject, html, text };
  },
};
