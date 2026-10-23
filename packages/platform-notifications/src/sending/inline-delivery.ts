import 'server-only';
import type { InlineClaim, InlineMailApi, InlineOutcome } from '@jadarat/platform-db';
import { PLATFORM_SENDER_TEMPLATES } from '../templates/index';
import type { InlineEmailRouter } from './router';
import { EmailSendError } from './transport';

/**
 * Sends a message the web app queued in its own transaction, the moment that transaction has committed
 * (WP-ADM-05 follow-up, PO 23 Oct 2026: "every e-mail arrives immediately"). The steps are the worker sender's
 * (sender.ts) over the same delivery row and the same lease, so the message goes out once whoever gets it:
 *
 *   claim   the request's secret claims it (`busy`: the worker's rescue holds the lease; `gone`: final,
 *           unknown or not served) and brings the organization's sender settings with it
 *   route   the sender rule over those settings (the organization's own provider when enabled, else the
 *           platform sender; the platform sender ONLY for the templates that open an account)
 *   send    with the delivery id as the provider's idempotency key
 *   finish  sent / failed (the content and the address are removed) / retry (back to the queue with the
 *           reason; the worker's rescue, or the sender-resume task for NO_SENDER, sends it later)
 *
 * It never throws: the response has gone; anything it cannot finish is left to the worker. Logs carry codes,
 * never addresses, content or secrets.
 */

export type InlineSendResult = 'sent' | 'failed' | 'waiting' | 'retry' | 'busy' | 'gone' | 'error';

type Log = (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, string>) => void;

export interface InlineDeliveryDeps {
  readonly api: InlineMailApi;
  readonly router: Pick<InlineEmailRouter, 'fromRow'>;
  readonly log: Log;
}

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code)) return code;
  return error instanceof Error && /^[A-Za-z]{2,64}$/.test(error.name) ? error.name : 'UNKNOWN';
};

export async function sendInlineDelivery(
  deps: InlineDeliveryDeps,
  id: string,
  secret: Buffer,
): Promise<InlineSendResult> {
  const { api, router, log } = deps;
  let claim: InlineClaim;
  try {
    claim = await api.claim(id, secret);
  } catch (error) {
    log('warn', 'inline e-mail: could not claim; the worker will send it', { reason: codeOf(error) });
    return 'error';
  }
  if (claim.outcome !== 'claimed') return claim.outcome;
  const { mail } = claim;

  const finish = async (outcome: InlineOutcome): Promise<void> => {
    try {
      if (!(await api.finish(id, secret, outcome))) {
        log('warn', 'inline e-mail: the outcome was not recorded (finished elsewhere)');
      }
    } catch (error) {
      // The message stays `sending`: the lease runs out and the worker's rescue sends it (once, by the
      // provider's idempotency key where it has one).
      log('error', 'inline e-mail: could not record the outcome', { reason: codeOf(error) });
    }
  };

  try {
    const route = router.fromRow(mail.route, mail.tenantId, {
      platformOnly: PLATFORM_SENDER_TEMPLATES.has(mail.template),
    });
    if (route.kind === 'wait') {
      // No sender ready (none verified yet, settings that cannot be opened): it waits - nothing is lost.
      await finish({ status: 'retry', errorCode: route.code });
      log('warn', `no e-mail sender ready (${route.code}); the message waits in the queue`);
      return 'waiting';
    }
    try {
      const sent = await route.transport.send({
        from: route.from,
        replyTo: route.replyTo,
        to: mail.destination,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        idempotencyKey: id,
      });
      await finish({
        status: 'sent',
        provider: route.transport.provider,
        providerMessageId: sent.providerMessageId,
        sender: route.sender,
      });
      return 'sent';
    } catch (error) {
      const failure =
        error instanceof EmailSendError ? error : new EmailSendError('SEND_FAILED', false);
      if (failure.permanent) {
        await finish({
          status: 'failed',
          errorCode: failure.code,
          provider: route.transport.provider,
          sender: route.sender,
        });
        log('error', `e-mail not delivered (${failure.code}); recorded as failed`);
        return 'failed';
      }
      await finish({ status: 'retry', errorCode: failure.code });
      log('warn', `e-mail not sent yet (${failure.code}); the worker will try again`);
      return 'retry';
    }
  } catch (error) {
    await finish({ status: 'retry', errorCode: 'SEND_FAILED' });
    log('error', 'inline e-mail: sending failed', { reason: codeOf(error) });
    return 'error';
  }
}
