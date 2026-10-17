import {
  claimEmailDelivery,
  discardInactiveTenantDelivery,
  finishEmailDelivery,
} from '@jadarat/platform-db/jobs';
import type { EffectSubscriber, InTenant, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import type { EmailRouter } from './router';
import {
  type EmailRoute,
  EmailSendError,
  type EmailTransport,
  type OutgoingEmail,
} from './transport';

/** Emitted with each queued e-mail (subject = delivery id); data carries the template key only. */
export const EMAIL_QUEUED_EVENT = 'com.entlaqa.platform.email.queued';
export const EMAIL_SENDER_NAME = 'notifications.email';
/**
 * About 3.5 hours of retries (graphile-worker waits e^n seconds after the n-th failure: 9 waits), then
 * the delivery is recorded as failed. Long enough to ride out a provider outage or replace a key.
 */
export const EMAIL_MAX_ATTEMPTS = 10;

type Log = (level: WorkerLogLevel, message: string) => void;

/** The sender rule per organization (router.ts), or one fixed route for every organization. */
type RouteFor = (tenantId: string, inTenant: InTenant) => Promise<EmailRoute>;

/**
 * Sends one queued e-mail (ADR 0008 §1, ADR 0004 §5): resolves the organization's sender (the sender rule,
 * WP-ADM-01), claims the delivery in its tenant, calls the provider with the delivery id as idempotency key,
 * records the outcome (content and address removed) and whose sender and provider it was. Temporary failures
 * go back to the queue and the job retries; on the last attempt, or for a refusal that a retry cannot fix,
 * the delivery is recorded as failed — an organization's own provider's failures are its own (no automatic
 * switch to another sender, PO 17 Oct 2026). Without a sender ready (none verified yet, or settings that
 * cannot be used) the delivery WAITS in the queue with the reason (NO_SENDER / CREDENTIALS_UNAVAILABLE) and
 * the job ends: the resume task queues it again once a sender is ready (nothing is lost). For a suspended or
 * closed organization it is discarded (suppressed). Only events written by a job (`queueEmail`) are acted
 * on. Logs carry codes, never addresses or content.
 */
export function createEmailSender(options: {
  readonly log: Log;
  /** The sender rule over the settings in the database (createEmailRouter). */
  readonly router?: EmailRouter;
  /** Without a router: one transport and sender for every organization (null: messages wait). */
  readonly transport?: EmailTransport | null;
  readonly from?: OutgoingEmail['from'];
}): EffectSubscriber {
  const { log, router } = options;
  const fixed: EmailRoute =
    options.transport && options.from
      ? { kind: 'send', transport: options.transport, from: options.from, sender: 'installation' }
      : { kind: 'wait', code: 'NO_SENDER' };
  const routeFor: RouteFor = router
    ? (tenantId, inTenant) => inTenant((tx) => router.resolve(tx, tenantId))
    : () => Promise.resolve(fixed);
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
        await send(await routeFor(event.tenantId, inTenant), log, id, inTenant, last);
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
  route: EmailRoute,
  log: Log,
  id: string,
  inTenant: InTenant,
  last: boolean,
): Promise<void> {
  const claimed = await inTenant((tx) =>
    claimEmailDelivery(tx, id, route.kind === 'send' ? route.sender : undefined),
  );
  if (!claimed) return; // already finished: a repeated job
  if (claimed === 'busy') {
    // Another sender holds it (a duplicate event): it records the outcome; check again later.
    if (last) return;
    throw new EmailSendError('DELIVERY_BUSY', false);
  }
  if (route.kind === 'wait') {
    // Back to the queue with the reason: it waits — however long — until a sender is ready.
    await inTenant((tx) => finishEmailDelivery(tx, id, { status: 'retry', errorCode: route.code }));
    log('warning', `no e-mail sender ready (${route.code}); the message waits in the queue`);
    return;
  }
  const { transport } = route;
  let result: { readonly providerMessageId: string | null };
  try {
    result = await transport.send({
      from: route.from,
      replyTo: route.replyTo,
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
        finishEmailDelivery(tx, id, {
          status: 'failed',
          errorCode: failure.code,
          provider: transport.provider,
        }),
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
