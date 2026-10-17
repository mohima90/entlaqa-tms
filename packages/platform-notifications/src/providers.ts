import { z } from 'zod';
import { isEmailAddress } from './address';

/**
 * The e-mail providers a sender can use (WP-ADM-01, FR-NTF-11; the five Kawadir providers, PO 17 Oct 2026):
 * the platform sender set by the Super Admin and an organization's own provider (Email integration). Each
 * has NON-SECRET options (shown back on the settings pages, stored in clear) and SECRETS (write-only: sealed
 * for the worker by the web app, opened by the worker only — never shown, logged or audited). The same
 * schemas validate the pages' input and, again, what the worker opens.
 */
export const EMAIL_PROVIDERS = [
  'resend',
  'smtp',
  'sendgrid',
  'mailgun',
  'microsoft_graph',
] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDERS)[number];

export function isEmailProvider(value: unknown): value is EmailProviderId {
  return typeof value === 'string' && (EMAIL_PROVIDERS as readonly string[]).includes(value);
}

const HOST =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A secret: one token without spaces or control characters. */
const TOKEN = /^[\x21-\x7E]+$/;

const hostName = z.string().trim().toLowerCase().max(253).regex(HOST);

/** Non-secret options per provider (stored in clear, shown on the page). */
export const EMAIL_PROVIDER_OPTIONS = {
  resend: z.strictObject({}),
  sendgrid: z.strictObject({}),
  mailgun: z.strictObject({
    /** The sending domain verified at Mailgun (e.g. mg.example.com). */
    domain: hostName,
    /** Mailgun's US or EU API. */
    region: z.enum(['us', 'eu']),
  }),
  smtp: z.strictObject({
    host: hostName,
    port: z.int().min(1).max(65535),
    /** `starttls` (usually 587; required, never plain text) or `tls` (implicit TLS, usually 465). */
    security: z.enum(['starttls', 'tls']),
    /** Empty: a relay that needs no sign-in (an internal relay that trusts the worker's network). */
    username: z
      .string()
      .trim()
      .max(320)
      .refine((v) => !/[\p{Cc}]/u.test(v)),
  }),
  microsoft_graph: z.strictObject({
    /** The Microsoft Entra tenant: its id (GUID) or a verified domain. */
    tenantId: z
      .string()
      .trim()
      .max(253)
      .refine((v) => GUID.test(v) || HOST.test(v)),
    /** The app registration's application (client) id. */
    clientId: z.string().trim().regex(GUID),
  }),
} as const satisfies Record<EmailProviderId, z.ZodType>;

/** Secrets per provider (sealed for the worker, never shown again). */
export const EMAIL_PROVIDER_SECRETS = {
  resend: z.strictObject({
    apiKey: z
      .string()
      .trim()
      .regex(/^re_[A-Za-z0-9_]{8,200}$/),
  }),
  sendgrid: z.strictObject({
    apiKey: z
      .string()
      .trim()
      .regex(/^SG\.[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{8,200}$/),
  }),
  mailgun: z.strictObject({ apiKey: z.string().trim().min(8).max(200).regex(TOKEN) }),
  smtp: z.strictObject({
    // Spaces may appear in a password; control characters may not (they could end an SMTP command).
    password: z
      .string()
      .max(500)
      .refine((v) => !/[\p{Cc}]/u.test(v)),
  }),
  microsoft_graph: z.strictObject({
    clientSecret: z.string().trim().min(8).max(200).regex(TOKEN),
  }),
} as const satisfies Record<EmailProviderId, z.ZodType>;

export type EmailProviderOptions<P extends EmailProviderId> = z.output<
  (typeof EMAIL_PROVIDER_OPTIONS)[P]
>;
export type EmailProviderSecrets<P extends EmailProviderId> = z.output<
  (typeof EMAIL_PROVIDER_SECRETS)[P]
>;

/** A provider's options and secrets (secrets optional: leave empty to keep the saved ones). */
const providerInput = <P extends EmailProviderId>(provider: P) =>
  z.strictObject({
    provider: z.literal(provider),
    options: EMAIL_PROVIDER_OPTIONS[provider],
    secrets: EMAIL_PROVIDER_SECRETS[provider].nullable(),
  });

/** The provider part of the settings forms (Super Admin and Organization Admin alike). */
export const EmailProviderInput = z.discriminatedUnion('provider', [
  providerInput('resend'),
  providerInput('smtp'),
  providerInput('sendgrid'),
  providerInput('mailgun'),
  providerInput('microsoft_graph'),
]);
export type EmailProviderInput = z.output<typeof EmailProviderInput>;

/** A sender's display name: one line of 1–100 characters (the database checks it too). */
export const SenderName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((v) => !/[\p{Cc}‪-‮⁦-⁩]/u.test(v));

/** An e-mail address (as the database's private.email_address_is_valid). */
export const EmailAddress = z.string().trim().max(254).refine(isEmailAddress);

/**
 * Codes the worker records for a test e-mail or a delivery, and the pages explain (the provider's own
 * texts are never kept: they may quote addresses). Unknown codes are shown as they are.
 */
export const EMAIL_ERROR_CODES = [
  'PROVIDER_AUTH',
  'PROVIDER_REJECTED',
  'PROVIDER_UNAVAILABLE',
  'ADDRESS_REJECTED',
  'SENDER_NOT_ALLOWED',
  'NETWORK_ERROR',
  'TLS_FAILED',
  'SMTP_HOST_NOT_ALLOWED',
  'CREDENTIALS_KEY_MISSING',
  'CREDENTIALS_KEY_CHANGED',
  'CREDENTIALS_INVALID',
  'PROVIDER_SETTINGS_INVALID',
  'RATE_LIMITED',
  'NO_SENDER',
  'CREDENTIALS_UNAVAILABLE',
  'STALE',
  'SENDER_WAIT_EXPIRED',
  'TENANT_INACTIVE',
  'SEND_FAILED',
] as const;
export type EmailErrorCode = (typeof EMAIL_ERROR_CODES)[number];

export function isKnownEmailErrorCode(code: string): code is EmailErrorCode {
  return (EMAIL_ERROR_CODES as readonly string[]).includes(code);
}
