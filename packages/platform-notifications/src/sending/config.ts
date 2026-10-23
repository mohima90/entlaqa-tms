import 'server-only';
import { readFileSync } from 'node:fs';
import { isEmailAddress } from '../address';
import { createResendTransport } from './resend';
import { createSmtpTransport, parseSmtpUrl } from './smtp';
import type { EmailTransport, OutgoingEmail } from './transport';

export interface EmailSettings {
  /**
   * The installation's sender (self-hosted relays): `none` (or unset) — no installation sender; the sender is
   * set in the product (Super Admin → Platform settings → Email; WP-ADM-01) and messages wait until then.
   */
  readonly provider: 'resend' | 'smtp' | 'none';
  readonly from: OutgoingEmail['from'];
  createTransport(): EmailTransport | null;
}

const read = (env: Readonly<Record<string, string | undefined>>, name: string) => {
  const value = env[name]?.trim();
  return value === '' ? undefined : value;
};

/**
 * The installation's sender from the worker's environment (ADR 0008 §2; names in .env.example): for
 * self-hosted installations whose operator runs the mail relay (SMTP) — used only while the Super Admin has
 * not saved a platform sender in the product (WP-ADM-01, which wins once saved). The hosted SaaS sets none
 * (PO, 16–17 Oct 2026: no e-mail settings in GitHub, Vercel or Supabase). Its credentials exist only in the
 * worker's environment, never in the web app's (ADR 0005 §1). Error messages name variables, never values.
 */
export function readEmailSettings(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): EmailSettings {
  // Unset = none: no installation sender (messages wait for the sender set in the product, never dropped).
  const provider = read(env, 'EMAIL_PROVIDER') ?? 'none';
  if (provider !== 'resend' && provider !== 'smtp' && provider !== 'none') {
    throw new Error('EMAIL_PROVIDER must be resend, smtp or none (no installation sender)');
  }
  const address = read(env, 'EMAIL_FROM_ADDRESS') ?? '';
  const name = read(env, 'EMAIL_FROM_NAME') ?? 'Jadarat';
  if (provider === 'none') {
    return { provider, from: { name, address }, createTransport: () => null };
  }
  if (!isEmailAddress(address)) throw new Error('EMAIL_FROM_ADDRESS must be an e-mail address');
  if (name.length > 100 || /[\r\n]/.test(name)) {
    throw new Error('EMAIL_FROM_NAME must be one line of at most 100 characters');
  }
  const from = { name, address };
  if (provider === 'resend') {
    const apiKey = read(env, 'RESEND_API_KEY');
    if (!apiKey || !/^re_[A-Za-z0-9_]{8,200}$/.test(apiKey)) {
      throw new Error('RESEND_API_KEY must be set to a Resend API key (re_…)');
    }
    return { provider, from, createTransport: () => createResendTransport({ apiKey }) };
  }
  const url = read(env, 'SMTP_URL');
  if (!url) throw new Error('SMTP_URL must be set for EMAIL_PROVIDER=smtp');
  const settings = parseSmtpUrl(url);
  const caFile = read(env, 'SMTP_CA_CERT_FILE');
  const caPem = read(env, 'SMTP_CA_CERT') ?? (caFile ? readFile(caFile) : undefined);
  if (caPem !== undefined && !caPem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('SMTP_CA_CERT / SMTP_CA_CERT_FILE must hold a PEM certificate');
  }
  return { provider, from, createTransport: () => createSmtpTransport(settings, caPem) };
}
