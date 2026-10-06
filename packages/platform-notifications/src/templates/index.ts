import type { AppLocale } from '@jadarat/platform-i18n';
import type { z } from 'zod';
import { invitationTemplate } from './invitation';
import type { RenderedEmail } from './types';

/** Every system e-mail template, by key (ADR 0008 §3). */
export const EMAIL_TEMPLATES = {
  'platform.invitation': invitationTemplate,
} as const;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;
export type EmailVariables<K extends EmailTemplateKey> = z.input<
  (typeof EMAIL_TEMPLATES)[K]['variables']
>;

/** Validates the variables (throws a ZodError naming the fields) and renders both languages. */
export function renderEmail<K extends EmailTemplateKey>(
  key: K,
  primary: AppLocale,
  variables: EmailVariables<K>,
): RenderedEmail & { readonly version: number } {
  const template = EMAIL_TEMPLATES[key];
  const parsed = template.variables.parse(variables);
  return { ...template.render(parsed, primary), version: template.version };
}
