import 'server-only';
import { randomUUID } from 'node:crypto';
import type { InlineEmailTestApi, InlineEmailTestTicket } from '@jadarat/platform-db';
import { credentialsContext } from '../credentials-seal';
import { isEmailProvider } from '../providers';
import { renderEmail } from '../templates/index';
import { CredentialsError, type CredentialsKeyPair } from './credentials';
import { createProviderTransport } from './factory';
import type { HostLookup } from './smtp';
import { EmailSendError } from './transport';

/**
 * Sending the test e-mail of the sender settings (WP-ADM-01; Kawadir's «Save & send test», «Send test e-mail»)
 * through the settings being tested - never another sender. Shared by the worker's test task (jobs/email-tasks)
 * and the web app's immediate sending (below; WP-ADM-05 follow-up, PO 23 Oct 2026).
 */

/** The platform's name in a test e-mail of the platform sender. */
export const PLATFORM_NAME = { ar: 'جدارات', en: 'Jadarat' } as const;

/** What a test needs (both the worker's claim and the web app's). The recipient is personal data. */
export interface EmailTestToSend {
  readonly tenantId: string | null;
  readonly recipient: string;
  readonly provider: string;
  readonly options: unknown;
  readonly credentialsSealed: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly replyTo: string | null;
}

export interface EmailTestSendOptions {
  readonly keys: CredentialsKeyPair | null;
  readonly smtpCaPem?: string | undefined;
  /** EMAIL_PLATFORM_SMTP_ALLOW_PRIVATE=true: the platform sender's SMTP relay may be internal. */
  readonly allowPrivatePlatformSmtp?: boolean | undefined;
  readonly lookup?: HostLookup | undefined;
  readonly transportFor?: typeof createProviderTransport | undefined;
}

/** A stable code for the page and the logs (never a message: they may quote the address). */
export function emailTestErrorCode(error: unknown): string {
  if (error instanceof CredentialsError || error instanceof EmailSendError) return error.code;
  return 'SEND_FAILED';
}

/** Opens the saved secrets, sends one sample e-mail to the recipient the admin chose. Throws on any failure. */
export async function sendEmailTest(
  test: EmailTestToSend,
  options: EmailTestSendOptions,
): Promise<void> {
  const { keys } = options;
  if (!keys) throw new CredentialsError('CREDENTIALS_KEY_MISSING');
  if (!isEmailProvider(test.provider)) throw new EmailSendError('PROVIDER_SETTINGS_INVALID', false);
  const scope =
    test.tenantId === null
      ? ({ kind: 'platform' } as const)
      : ({ kind: 'tenant', tenantId: test.tenantId } as const);
  const secrets = keys.open(
    test.credentialsSealed,
    credentialsContext(scope, test.provider, test.options),
  );
  const transportFor = options.transportFor ?? createProviderTransport;
  const transport = transportFor(test.provider, test.options, secrets, {
    organization: test.tenantId !== null,
    allowPrivatePlatformSmtp: options.allowPrivatePlatformSmtp === true,
    smtpCaPem: options.smtpCaPem,
    ...(options.lookup ? { lookup: options.lookup } : {}),
  });
  try {
    const email = renderEmail('platform.email_test', 'en', {
      senderOwner:
        test.tenantId === null ? PLATFORM_NAME : { ar: test.fromName, en: test.fromName },
      provider: test.provider,
      fromAddress: test.fromAddress,
    });
    await transport.send({
      from: { name: test.fromName, address: test.fromAddress },
      replyTo: test.replyTo ?? undefined,
      to: test.recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: randomUUID(),
    });
  } finally {
    await transport.close?.();
  }
}

type Log = (
  level: 'info' | 'warn' | 'error',
  message: string,
  fields?: Record<string, string>,
) => void;

/**
 * The web app's immediate test: sends the test the action claimed and records the outcome with the request's
 * secret. Never throws; a test nobody finishes is claimed by the worker after its lease.
 */
export async function sendInlineEmailTest(
  deps: EmailTestSendOptions & { readonly api: InlineEmailTestApi; readonly log: Log },
  ticket: InlineEmailTestTicket,
): Promise<'sent' | 'failed' | 'error'> {
  const { api, log } = deps;
  const { test, secret } = ticket;
  const whose = test.tenantId === null ? 'platform sender' : "organization's provider";
  let outcome: { readonly sent: true } | { readonly sent: false; readonly errorCode: string };
  try {
    await sendEmailTest(test, deps);
    outcome = { sent: true };
  } catch (error) {
    outcome = { sent: false, errorCode: emailTestErrorCode(error) };
  }
  try {
    const verified = await api.finish(secret, test.version, outcome);
    if (outcome.sent)
      log('info', `test e-mail of the ${whose} sent${verified ? ' (verified)' : ''}`);
    else log('warn', `test e-mail of the ${whose} not sent (${outcome.errorCode})`);
    return outcome.sent ? 'sent' : 'failed';
  } catch {
    log(
      'error',
      `test e-mail of the ${whose}: could not record the outcome; the worker will redo it`,
    );
    return 'error';
  }
}
