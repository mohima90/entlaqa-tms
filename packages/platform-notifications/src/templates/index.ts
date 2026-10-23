import type { AppLocale } from '@jadarat/platform-i18n';
import type { z } from 'zod';
import { type EmailBrandStyle, withEmailBrand } from '../layout';
import { accountLockedTemplate } from './account-locked';
import { emailTestTemplate } from './email-test';
import { invitationTemplate } from './invitation';
import { mfaCodeLockedTemplate } from './mfa-code-locked';
import { mfaFactorAddedTemplate } from './mfa-factor-added';
import { mfaFactorRemovedTemplate } from './mfa-factor-removed';
import { passwordChangedTemplate } from './password-changed';
import { passwordResetTemplate } from './password-reset';
import { securityDigestTemplate } from './security-digest';
import { securityPolicyChangedTemplate } from './security-policy-changed';
import { signInCodeTemplate } from './sign-in-code';
import { signInUnlockedTemplate } from './sign-in-unlocked';
import type { EmailTemplate, RenderedEmail } from './types';

/**
 * Every system e-mail template, by key (ADR 0008 §3). R2 (FR-NTF-10): an organization's own subject and
 * body for a key are looked up before these defaults, in `renderEmail`'s place — the one point every
 * e-mail is rendered through (queueEmail).
 */
export const EMAIL_TEMPLATES = {
  'platform.invitation': invitationTemplate,
  'platform.password_reset': passwordResetTemplate,
  'platform.password_changed': passwordChangedTemplate,
  'platform.mfa_factor_added': mfaFactorAddedTemplate,
  'platform.mfa_factor_removed': mfaFactorRemovedTemplate,
  'platform.security_policy_changed': securityPolicyChangedTemplate,
  'platform.security_digest': securityDigestTemplate,
  'platform.account_locked': accountLockedTemplate,
  'platform.sign_in_unlocked': signInUnlockedTemplate,
  'platform.mfa_code_locked': mfaCodeLockedTemplate,
  'platform.sign_in_code': signInCodeTemplate,
  'platform.email_test': emailTestTemplate,
} as const;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;
export type EmailVariables<K extends EmailTemplateKey> = z.input<
  (typeof EMAIL_TEMPLATES)[K]['variables']
>;

/**
 * Validates the variables (throws a ZodError naming the fields) and renders both languages — with the
 * organization's look when given (WP-ADM-02, FR-NTF-02: logo, button and link colour), else Jadarat's.
 */
export function renderEmail<K extends EmailTemplateKey>(
  key: K,
  primary: AppLocale,
  variables: EmailVariables<K>,
  brand?: EmailBrandStyle | null,
): RenderedEmail & { readonly version: number } {
  // Each template validates its own variables: the parsed value is that template's output type.
  const template: EmailTemplate<z.ZodType> = EMAIL_TEMPLATES[key];
  const parsed = template.variables.parse(variables);
  return withEmailBrand(brand, () => ({
    ...template.render(parsed, primary),
    version: template.version,
  }));
}
