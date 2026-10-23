import { randomUUID } from 'node:crypto';
import type { EmailRouteRow } from '@jadarat/platform-db';
import type { RenderedEmail } from '../templates/types';
import { readEmailSettings } from './config';
import {
  CredentialsError,
  type CredentialsKeyPair,
  EMAIL_CREDENTIALS_KEY_ENV,
  deriveCredentialsKeyPair,
} from './credentials';
import { type InlineEmailRouter, type SendLog, createSenderRule } from './router';
import { EmailSendError, type EmailSenderKind } from './transport';

/**
 * Sending an e-mail AT ONCE from the web tier (WP-ADM-05, PO 23 Oct 2026: "the way Kawadir sends them straight
 * from Vercel"). Used by the Send Email hook only, for the messages a person is waiting for with the page open:
 * the sign-in code. Everything else is queued in the delivery log and sent by the worker (ADR 0008).
 *
 * The sender rule is the worker's (router.ts) over the settings the hook route read through the database;
 * sealed provider secrets are opened with EMAIL_CREDENTIALS_KEY, which therefore also lives in the web app's
 * environment (ADR 0005 §1 amendment of 23 Oct 2026). Nothing is written to the delivery log: the content is
 * a one-time code, and it exists in memory for the duration of the call only. Errors name codes, never the
 * address, the code or a provider's message.
 */

export interface InlineEmailSender {
  /**
   * Sends one rendered e-mail through the organization's sender (or the platform sender when `platformOnly`).
   * Throws EmailSendError (a code; `NO_SENDER` / `CREDENTIALS_UNAVAILABLE` when no sender is ready, never a
   * fallback to another sender) and returns whose sender carried it.
   */
  send(message: {
    readonly row: EmailRouteRow | null;
    readonly tenantId: string;
    readonly platformOnly: boolean;
    readonly to: string;
    readonly email: RenderedEmail;
  }): Promise<{ readonly sender: EmailSenderKind }>;
}

export function createInlineEmailSender(
  router: Pick<InlineEmailRouter, 'fromRow'>,
): InlineEmailSender {
  return {
    async send({ row, tenantId, platformOnly, to, email }) {
      const route = router.fromRow(
        row,
        tenantId,
        platformOnly ? { platformOnly: true } : undefined,
      );
      if (route.kind === 'wait') throw new EmailSendError(route.code, false);
      await route.transport.send({
        from: route.from,
        replyTo: route.replyTo,
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        // A one-off key: a retry of the hook by Auth sends a new code anyway.
        idempotencyKey: randomUUID(),
      });
      return { sender: route.sender };
    },
  };
}

/**
 * The router of the web tier from its environment: EMAIL_CREDENTIALS_KEY (SECRET, the worker's value - opens
 * the provider secrets saved in the product), the installation sender of a self-hosted operator (EMAIL_PROVIDER
 * and its settings, as the worker reads them) and EMAIL_PLATFORM_SMTP_ALLOW_PRIVATE. Settings that cannot be
 * used leave that part off (the message then cannot be sent - nothing else happens); the problem is logged by
 * name, never by value.
 */
export function createInlineEmailRouter(
  env: Readonly<Record<string, string | undefined>>,
  log: SendLog,
): InlineEmailRouter {
  let keys: CredentialsKeyPair | null = null;
  const secret = env[EMAIL_CREDENTIALS_KEY_ENV];
  if (secret !== undefined && secret.trim() !== '') {
    try {
      keys = deriveCredentialsKeyPair(secret);
    } catch (error) {
      log(
        'error',
        `${EMAIL_CREDENTIALS_KEY_ENV} cannot be used (${error instanceof CredentialsError ? error.code : 'unusable value'})`,
      );
    }
  }
  let installation: Parameters<typeof createSenderRule>[0]['installation'] = null;
  try {
    const settings = readEmailSettings(env);
    const transport = settings.createTransport();
    if (transport) {
      installation = { transport, address: settings.from.address, name: settings.from.name };
    }
  } catch {
    log('error', 'the installation sender settings (EMAIL_PROVIDER …) cannot be used');
  }
  return createSenderRule({
    keys,
    installation,
    log,
    allowPrivatePlatformSmtp: env.EMAIL_PLATFORM_SMTP_ALLOW_PRIVATE === 'true',
  });
}
