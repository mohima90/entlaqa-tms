import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { isEmailAddress } from '../address';
import { formatEmailDate, isTimeZone } from '../format';
import { type SafeHtml, isSafeLink, markup } from '../html';
import { actionButton, link, ltr, paragraph, renderLayout } from '../layout';
import { Localized, PRODUCT, SIGNATURE, localizedName } from './shared';
import type { EmailTemplate } from './types';

const Link = z.string().max(2000).refine(isSafeLink, 'https link');

/** The settings of screen 6, by the names the database records (never their values). */
export const SECURITY_SETTING_NAMES = [
  'mfaMode',
  'mfaRequiredRoles',
  'mfaGraceDays',
  'mfaPromptAdmins',
  'passwordMinLength',
  'lockoutThreshold',
  'lockoutMinutes',
  'sessionIdleMinutes',
  'sessionMaxHours',
  'sessionMaxDevices',
] as const;
type SettingName = (typeof SECURITY_SETTING_NAMES)[number];

const LABELS: Readonly<Record<AppLocale, Readonly<Record<SettingName, string>>>> = {
  ar: {
    mfaMode: 'التحقق متعدد العوامل',
    mfaRequiredRoles: 'الأدوار الملزمة بالتحقق',
    mfaGraceDays: 'مهلة إعداد التطبيق',
    mfaPromptAdmins: 'دعوة مدير المنشأة إلى إعداد التطبيق',
    passwordMinLength: 'أقل طول لكلمة المرور',
    lockoutThreshold: 'المحاولات الفاشلة قبل القفل',
    lockoutMinutes: 'مدة القفل',
    sessionIdleMinutes: 'مدة عدم النشاط',
    sessionMaxHours: 'أقصى مدة للجلسة',
    sessionMaxDevices: 'أقصى عدد من الأجهزة',
  },
  en: {
    mfaMode: 'Multi-factor authentication',
    mfaRequiredRoles: 'Roles that must use it',
    mfaGraceDays: 'Set-up grace period',
    mfaPromptAdmins: 'Inviting Organization Admins to set up an app',
    passwordMinLength: 'Minimum password length',
    lockoutThreshold: 'Failed attempts before lockout',
    lockoutMinutes: 'Lockout duration',
    sessionIdleMinutes: 'Inactivity limit',
    sessionMaxHours: 'Maximum session length',
    sessionMaxDevices: 'Maximum devices',
  },
};

/**
 * "Security settings changed" (FR-IAM-12/13; T-M2-10; TM-0003 T-IAM-24; security review L5): every
 * Organization Admin of the organization is told which settings changed (names, never values), by whom and
 * when, with a link to the settings page. Queued by the database for every change (trigger), sent by the
 * worker to the admins' login addresses.
 */
export const SecurityPolicyChangedVariables = z.strictObject({
  organizationName: Localized(150),
  /** Who changed them (their name in this organization); null: the platform. */
  changedBy: Localized(200).nullable(),
  changed: z.array(z.enum(SECURITY_SETTING_NAMES)).min(1).max(SECURITY_SETTING_NAMES.length),
  changedAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().refine(isTimeZone, 'IANA time zone'),
  settingsUrl: z.strictObject({ ar: Link, en: Link }),
  loginEmail: z.string().refine(isEmailAddress, 'e-mail address'),
});

export type SecurityPolicyChangedVariables = z.output<typeof SecurityPolicyChangedVariables>;

function list(v: SecurityPolicyChangedVariables, locale: AppLocale): SafeHtml {
  const items = v.changed.map((name) => markup`<li>${LABELS[locale][name]}</li>`);
  return markup`<ul style="margin: 0 0 14px 0; padding-inline-start: 22px">${items}</ul>`;
}

function body(v: SecurityPolicyChangedVariables, locale: AppLocale, primary: boolean): SafeHtml {
  const url = v.settingsUrl[locale];
  const date = formatEmailDate(v.changedAt, locale, v.timeZone);
  const organization = localizedName(v.organizationName, locale);
  if (locale === 'ar') {
    const by = v.changedBy ? markup` بواسطة <b>${localizedName(v.changedBy, 'ar')}</b>` : markup``;
    return markup`<h1
        style="margin: 0 0 14px 0; font-size: ${primary ? '23px' : '18px'}; line-height: 1.5"
      >
        تغيّرت إعدادات الأمان
      </h1>
      ${paragraph(markup`تغيّرت إعدادات الأمان في ${organization}${by} يوم ${date}:`)}
      ${list(v, 'ar')}
      ${primary ? actionButton('مراجعة إعدادات الأمان', url) : paragraph(link('مراجعة إعدادات الأمان', url))}
      ${paragraph(markup`إن لم يكن هذا التغيير متوقعًا، يمكنك مراجعة الإعدادات الآن وإبلاغ مدير المنشأة الآخر.`, true, true)}`;
  }
  const by = v.changedBy ? markup` by <b>${localizedName(v.changedBy, 'en')}</b>` : markup``;
  return markup`<h1
      style="margin: 0 0 12px 0; font-size: ${primary ? '22px' : '17px'}; line-height: 1.4"
    >
      Security settings changed
    </h1>
    ${paragraph(markup`The security settings of ${organization} were changed${by} on ${date}:`)}
    ${list(v, 'en')}
    ${primary ? actionButton('Review the security settings', url) : paragraph(link('Review the security settings', url))}
    ${paragraph(markup`If you didn't expect this change, review the settings now and tell the other Organization Admins.`, true, true)}`;
}

function plain(v: SecurityPolicyChangedVariables, locale: AppLocale): string {
  const date = formatEmailDate(v.changedAt, locale, v.timeZone);
  const organization = localizedName(v.organizationName, locale);
  const items = v.changed.map((name) => `- ${LABELS[locale][name]}`);
  if (locale === 'ar') {
    const by = v.changedBy ? ` بواسطة ${localizedName(v.changedBy, 'ar')}` : '';
    return [
      'تغيّرت إعدادات الأمان',
      '',
      `تغيّرت إعدادات الأمان في ${organization}${by} يوم ${date}:`,
      ...items,
      '',
      'مراجعة إعدادات الأمان:',
      v.settingsUrl.ar,
      'إن لم يكن هذا التغيير متوقعًا، يمكنك مراجعة الإعدادات الآن وإبلاغ مدير المنشأة الآخر.',
    ].join('\n');
  }
  const by = v.changedBy ? ` by ${localizedName(v.changedBy, 'en')}` : '';
  return [
    'Security settings changed',
    '',
    `The security settings of ${organization} were changed${by} on ${date}:`,
    ...items,
    '',
    'Review the security settings:',
    v.settingsUrl.en,
    "If you didn't expect this change, review the settings now and tell the other Organization Admins.",
  ].join('\n');
}

const SUBJECT: Readonly<Record<AppLocale, string>> = {
  ar: 'تغيّرت إعدادات الأمان · Security settings changed',
  en: 'Security settings changed · تغيّرت إعدادات الأمان',
};

export const securityPolicyChangedTemplate: EmailTemplate<typeof SecurityPolicyChangedVariables> = {
  key: 'platform.security_policy_changed',
  version: 1,
  variables: SecurityPolicyChangedVariables,
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
