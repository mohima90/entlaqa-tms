import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { formatEmailDateTime, isTimeZone } from '../format';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { actionButton, link, ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');

/** The security notices a digest merges (the database's held kinds). */
export const DIGEST_KINDS = [
  'mfa_factor_added',
  'mfa_factor_removed',
  'security_policy_changed',
  'password_changed',
] as const;
type DigestKind = (typeof DIGEST_KINDS)[number];

const Count = z.number().int().min(1).max(100_000);

/**
 * "Many security changes on your account" (FR-IAM-12; T-M2-10; final re-review L1, TM-0003 RR-IAM-10): once
 * an account received its daily ceiling of security notices (20 in 24 hours), further ones are not sent one
 * by one but merged into this digest — at most one an hour — which counts them by kind since the first one
 * held. Never dropped, never a flood. Its only link is the "forgot password" page in each language.
 */
export const SecurityDigestVariables = z.strictObject({
  organizationName: Localized(150),
  held: z
    .strictObject({
      mfa_factor_added: Count.optional(),
      mfa_factor_removed: Count.optional(),
      security_policy_changed: Count.optional(),
      password_changed: Count.optional(),
    })
    .refine((h) => Object.values(h).some((n) => n !== undefined), 'at least one kind'),
  since: z.iso.datetime({ offset: true }),
  timeZone: z.string().refine(isTimeZone, 'IANA time zone'),
  forgotPasswordUrl: z.strictObject({ ar: Link, en: Link }),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type SecurityDigestVariables = z.output<typeof SecurityDigestVariables>;

const LABELS: Readonly<Record<AppLocale, Readonly<Record<DigestKind, string>>>> = {
  ar: {
    mfa_factor_added: 'إضافة تطبيق مصادقة',
    mfa_factor_removed: 'إزالة تطبيق مصادقة',
    security_policy_changed: 'تغيير إعدادات الأمان',
    password_changed: 'تغيير كلمة المرور',
  },
  en: {
    mfa_factor_added: 'Authenticator app added',
    mfa_factor_removed: 'Authenticator app removed',
    security_policy_changed: 'Security settings changed',
    password_changed: 'Password changed',
  },
};

const TEXT = {
  ar: {
    title: 'تغييرات أمان كثيرة في حسابك',
    lead: (email: string, when: string) =>
      `منذ ${when} وقعت في الحساب ${email} تغييرات أمان أكثر مما نرسله رسالةً رسالة، فجمعناها هنا:`,
    // Arabic counting: one, two, 3–10 (plural), 11 and more (singular).
    times: (n: number) =>
      n === 1
        ? 'مرة واحدة'
        : n === 2
          ? 'مرتان'
          : n <= 10
            ? `${String(n)} مرات`
            : `${String(n)} مرة`,
    action: 'تعيين كلمة مرور جديدة',
    after:
      'إن لم تكن هذه التغييرات منك، يلزم تعيين كلمة مرور جديدة الآن وإبلاغ مدير المنشأة. تصلك الرسائل القادمة مجمّعةً بهذا الشكل مرة كل ساعة على الأكثر ما دام عددها كبيرًا.',
  },
  en: {
    title: 'Many security changes on your account',
    lead: (email: string, when: string) =>
      `Since ${when}, ${email} had more security changes than we send one by one, so here they are together:`,
    times: (n: number) => `${String(n)} ${n === 1 ? 'time' : 'times'}`,
    action: 'Set a new password',
    after:
      "If you didn't make these changes, set a new password now and tell your organization's administrator. While there are this many, further notices arrive like this, at most once an hour.",
  },
} as const;

function kinds(v: SecurityDigestVariables): [DigestKind, number][] {
  return DIGEST_KINDS.flatMap((kind) => {
    const n = v.held[kind];
    return n === undefined ? [] : [[kind, n] as [DigestKind, number]];
  });
}

function body(v: SecurityDigestVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const t = TEXT[locale];
  const url = v.forgotPasswordUrl[locale];
  const when = formatEmailDateTime(v.since, locale, v.timeZone);
  const heading = primary ? (locale === 'ar' ? '23px' : '22px') : locale === 'ar' ? '18px' : '17px';
  const items = kinds(v).map(
    ([kind, n]) => markup`<li>${LABELS[locale][kind]}: <b>${t.times(n)}</b></li>`,
  );
  const lead =
    locale === 'ar'
      ? markup`منذ <b>${when}</b> وقعت في الحساب ${ltr(v.loginEmail)} تغييرات أمان أكثر مما نرسله رسالةً رسالة، فجمعناها هنا:`
      : markup`Since <b>${when}</b>, ${v.loginEmail} had more security changes than we send one by one, so here they are together:`;
  return markup`<h1 style="margin: 0 0 14px 0; font-size: ${heading}; line-height: 1.5">${t.title}</h1>
    ${paragraph(lead)}
    <ul style="margin: 0 0 14px 0; padding-inline-start: 22px">${items}</ul>
    ${primary ? actionButton(t.action, url) : paragraph(link(t.action, url))}
    ${paragraph(markup`${t.after}`, true, true)}`;
}

function plain(v: SecurityDigestVariables, locale: AppLocale): string {
  const t = TEXT[locale];
  return [
    t.title,
    '',
    t.lead(v.loginEmail, formatEmailDateTime(v.since, locale, v.timeZone)),
    ...kinds(v).map(([kind, n]) => `- ${LABELS[locale][kind]}: ${t.times(n)}`),
    '',
    `${t.action}:`,
    v.forgotPasswordUrl[locale],
    t.after,
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'تغييرات أمان كثيرة في حسابك · Many security changes on your account',
  en: 'Many security changes on your account · تغييرات أمان كثيرة في حسابك',
};

export const securityDigestTemplate: EmailTemplate<typeof SecurityDigestVariables> = {
  key: 'platform.security_digest',
  version: 1,
  variables: SecurityDigestVariables,
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
