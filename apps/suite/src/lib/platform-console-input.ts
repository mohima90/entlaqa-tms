import { hasVisibleText } from '@jadarat/platform-i18n';
import { EmailAddress, EmailProviderInput, SenderName } from '@jadarat/platform-notifications';
import { z } from 'zod';
import { isOrganizationSlug } from './organization-slug';

/**
 * Inputs of the Platform Super Admin console's actions (apps/suite/src/auth/platform-console.ts; FR-ADM-17).
 * Strict: unknown fields are refused. The database validates everything again
 * (private.platform_create_tenant). Field-error codes only (never values) reach the client.
 */

// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const organizationName = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !CONTROL.test(value), { message: 'control' })
    .refine((value) => value === '' || hasVisibleText(value), { message: 'invisible' });

const personName = organizationName(100).optional();

export const CreateOrganizationInput = z
  .strictObject({
    slug: z.string().refine(isOrganizationSlug, { message: 'slug' }),
    nameAr: organizationName(200).pipe(z.string().min(1)),
    nameEn: organizationName(200).optional(),
    adminEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    adminFirstNameAr: personName,
    adminFamilyNameAr: personName,
    adminFirstNameEn: personName,
    adminFamilyNameEn: personName,
    // English is the default language for now (PO, 14 Oct 2026).
    locale: z.enum(['ar', 'en']).default('en'),
  })
  .superRefine((value, ctx) => {
    // The admin's names are optional (they set their own on the sign-up page), but each language's are all
    // or nothing: a first name without the family name is half a name (WP-FIX-01 review; the database never
    // puts English text in the Arabic name, 20261021100100). The empty field gets the error.
    for (const [first, family] of [
      ['adminFirstNameAr', 'adminFamilyNameAr'],
      ['adminFirstNameEn', 'adminFamilyNameEn'],
    ] as const) {
      const hasFirst = (value[first] ?? '') !== '';
      const hasFamily = (value[family] ?? '') !== '';
      if (hasFirst !== hasFamily) {
        ctx.addIssue({ code: 'custom', path: [hasFirst ? family : first], message: 'pair' });
      }
    }
  });

export type CreateOrganizationInputValue = z.output<typeof CreateOrganizationInput>;

export const OrganizationRefInput = z.strictObject({ tenantId: z.uuid() });

/**
 * Platform settings → Email «حفظ وإرسال رسالة تجريبية» (WP-ADM-01): provider (options; secrets optional —
 * empty keeps the saved ones), sender name and address, where the test e-mail goes, and the version the page
 * showed. The database validates everything again (private.platform_save_email_settings).
 */
export const PlatformEmailSettingsInput = z.strictObject({
  version: z.int().min(1).nullable(),
  provider: EmailProviderInput,
  fromName: SenderName,
  fromAddress: EmailAddress,
  testTo: EmailAddress,
});
