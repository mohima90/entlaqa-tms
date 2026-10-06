import {
  claimEmailDelivery,
  discardInactiveTenantDelivery,
  finishEmailDelivery,
} from '@jadarat/platform-db/jobs';
import type { EffectSubscriber, InTenant, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { EmailSendError, type EmailTransport, type OutgoingEmail } from './transport';

/** Emitted with each queued e-mail (subject = delivery id); data carries the template key only. */
export const EMAIL_QUEUED_EVENT = 'com.entlaqa.platform.email.queued';
export const EMAIL_SENDER_NAME = 'notifications.email';
/**
 * About 3.5 hours of retries (graphile-worker waits e^n seconds after the n-th failure: 9 waits), then
 * the delivery is recorded as failed. Long enough to ride out a provider outage or replace a key.
 */
export const EMAIL_MAX_ATTEMPTS = 10;

type Log = (level: WorkerLogLevel, message: string) => void;

/**
 * Sends one queued e-mail (ADR 0008 §1, ADR 0004 §5): claims the delivery in its tenant, calls the
 * provider with the delivery id as idempotency key, records the outcome (content and address removed).
 * Temporary failures go back to the queue and the job retries; on the last attempt, or for a refusal
 * that a retry cannot fix, the delivery is recorded as failed. Without a provider (e-mail switched off)
 * the delivery is recorded as suppressed; for a suspended or closed organization it is discarded
 * (suppressed). Only events written by a job (`queueEmail`) are acted on. Logs carry codes, never
 * addresses or content.
 */
export function createEmailSender(options: {
  readonly transport: EmailTransport | null;
  readonly from: OutgoingEmail['from'];
  readonly log: Log;
}): EffectSubscriber {
  const { log } = options;
  return {
    kind: 'effect',
    name: EMAIL_SENDER_NAME,
    types: [EMAIL_QUEUED_EVENT],
    maxAttempts: EMAIL_MAX_ATTEMPTS,
    async perform({ event, inTenant, attempt, maxAttempts }) {
      const id = event.subject;
      if (!id) return;
      if (event.actorType !== 'system') {
        log('warning', 'e-mail event not written by a job; ignored');
        return;
      }
      const last = attempt >= maxAttempts;
      try {
        await send(options, id, inTenant, last);
      } catch (error) {
        if (last) {
          // The last attempt failed outside the provider call (e.g. the database): the content and
          // address must not stay behind — recorded as failed, or discarded if the organization was
          // suspended meanwhile. Best effort; the original error is what the job reports.
          await inTenant((tx) =>
            finishEmailDelivery(tx, id, { status: 'failed', errorCode: 'DELIVERY_ERROR' }),
          )
            .catch(() => inTenant((tx) => discardInactiveTenantDelivery(tx, id)))
            .catch(() => undefined);
        }
        throw error;
      }
    },
    async discard({ event, inTenant }) {
      const id = event.subject;
      if (!id) return;
      if (await inTenant((tx) => discardInactiveTenantDelivery(tx, id))) {
        log('warning', 'organization not active; e-mail discarded (recorded as suppressed)');
      }
    },
  };
}

async function send(
  options: {
    readonly transport: EmailTransport | null;
    readonly from: OutgoingEmail['from'];
    readonly log: Log;
  },
  id: string,
  inTenant: InTenant,
  last: boolean,
): Promise<void> {
  const { transport, from, log } = options;
  const claimed = await inTenant((tx) => claimEmailDelivery(tx, id));
  if (!claimed) return; // already finished: a repeated job
  if (claimed === 'busy') {
    // Another sender holds it (a duplicate event): it records the outcome; check again later.
    if (last) return;
    throw new EmailSendError('DELIVERY_BUSY', false);
  }
  if (!transport) {
    await inTenant((tx) =>
      finishEmailDelivery(tx, id, { status: 'suppressed', errorCode: 'EMAIL_DISABLED' }),
    );
    log('warning', 'e-mail is switched off (EMAIL_PROVIDER=none); message recorded as suppressed');
    return;
  }
  let result: { readonly providerMessageId: string | null };
  try {
    result = await transport.send({
      from,
      to: claimed.destination,
      subject: claimed.subject,
      html: claimed.html,
      text: claimed.text,
      idempotencyKey: claimed.id,
    });
  } catch (error) {
    const failure =
      error instanceof EmailSendError ? error : new EmailSendError('SEND_FAILED', false);
    if (failure.permanent || last) {
      await inTenant((tx) =>
        finishEmailDelivery(tx, id, { status: 'failed', errorCode: failure.code }),
      );
      log('error', `e-mail not delivered (${failure.code}); recorded as failed`);
      return;
    }
    await inTenant((tx) =>
      finishEmailDelivery(tx, id, { status: 'retry', errorCode: failure.code }),
    );
    throw failure;
  }
  await inTenant((tx) =>
    finishEmailDelivery(tx, id, {
      status: 'sent',
      provider: transport.provider,
      providerMessageId: result.providerMessageId,
    }),
  );
}
