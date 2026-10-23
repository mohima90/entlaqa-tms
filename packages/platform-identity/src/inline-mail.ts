import 'server-only';
import {
  type ClaimsTx,
  type InlineMailApi,
  type InlineInvitationFacts,
  type InlineMailTicket,
  type InlineMailToQueue,
  inlineMailApi,
  prepareInlineInvitation,
  queueInlineEmail,
} from '@jadarat/platform-db';
import { isSafeLink, renderEmail } from '@jadarat/platform-notifications';
import {
  type InlineEmailRouter,
  brandAssetUrl,
  createInlineEmailRouter,
  sendInlineDelivery,
} from '@jadarat/platform-notifications/inline';
import { log } from '@jadarat/platform-observability';
import { after } from 'next/server';
import { type RoleNameLookup, invitationEmailVariables } from './invitation-email';

/**
 * E-mail sent the moment the action commits (WP-ADM-05 follow-up; PO 23 Oct 2026: "every e-mail arrives
 * immediately", the Kawadir way; ADR 0005 §1 amendments). The web adapter of the immediate sending:
 *
 *   in the action's transaction   the facts are read through a function that re-checks the member's authority,
 *                                 the message is rendered (the same builders as the worker's mailers) and
 *                                 queued in the delivery log (private.inline_mail_queue), which hands back the
 *                                 request's secret
 *   after the response            `after()` claims it with that secret and sends it through the sender rule
 *                                 (sendInlineDelivery); the claim shares ONE lease with the worker's sender
 *
 * The worker stays the safety net: a message nobody finished within a minute is queued for its sender (the
 * rescue task), and its mailers skip a message queued here (source_key) - so a message goes out once, whoever
 * gets it. Any failure here leaves the action's own work untouched (a savepoint) and falls back to the worker.
 * Where the web app has no e-mail credentials (self-hosted without EMAIL_CREDENTIALS_KEY and without an
 * installation sender) nothing is queued here at all: the worker does it as before.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** Does this deployment's web app hold what it needs to send (the key that opens saved provider secrets, or an installation sender)? */
export function inlineMailConfigured(env: Env = process.env): boolean {
  const key = env.EMAIL_CREDENTIALS_KEY?.trim() ?? '';
  const installation = (env.EMAIL_PROVIDER?.trim() ?? '') !== '' && env.EMAIL_PROVIDER?.trim() !== 'none';
  return key.length >= 32 || installation;
}

/** The public origin for links in e-mails (APP_BASE_URL), without a trailing slash; undefined when unusable. */
export function inlineMailBase(env: Env = process.env): string | undefined {
  let base = env.APP_BASE_URL?.trim() ?? '';
  while (base.endsWith('/')) base = base.slice(0, -1);
  return base !== '' && isSafeLink(base) ? base : undefined;
}

let sharedRouter: InlineEmailRouter | null = null;

/** The web tier's sender rule over its environment: one instance (its transports are cached for a minute). */
export function inlineEmailRouter(): InlineEmailRouter {
  sharedRouter ??= createInlineEmailRouter(process.env, (level, message) => {
    const fn = level === 'error' ? log.error : level === 'warning' ? log.warn : log.info;
    fn(message, { action: 'platform.email.inline' });
  });
  return sharedRouter;
}

export interface InlineMailerDeps {
  readonly configured: () => boolean;
  readonly base: () => string | undefined;
  readonly prepare: (tx: ClaimsTx, invitationId: string) => Promise<InlineInvitationFacts | null>;
  readonly queue: (tx: ClaimsTx, mail: InlineMailToQueue) => Promise<InlineMailTicket | null>;
  /** Runs `work` once the response has gone (the platform's `after()`); outside a request, right away. */
  readonly schedule: (work: () => Promise<unknown>) => void;
  readonly send: (ticket: InlineMailTicket) => Promise<unknown>;
  readonly warn: (message: string, fields?: Record<string, string>) => void;
}

/** The invitation e-mail, queued in the action's transaction and sent once it has committed. */
export function createInlineInvitationMailer(deps: InlineMailerDeps) {
  return async function queueInvitationEmail(
    tx: ClaimsTx,
    invitationId: string,
    roleName: RoleNameLookup,
  ): Promise<void> {
    if (!deps.configured()) return;
    const base = deps.base();
    if (!base) return;
    try {
      // A savepoint: whatever goes wrong here must not spoil the action's own transaction.
      const ticket = await tx.transaction(async (savepoint) => {
        const facts = await deps.prepare(savepoint, invitationId);
        if (!facts) return null;
        const rendered = renderEmail(
          'platform.invitation',
          facts.locale,
          invitationEmailVariables(facts, facts.code, base, roleName),
          facts.brand
            ? {
                actionColor: facts.brand.actionColor,
                linkColor: facts.brand.linkColor,
                logoUrl: brandAssetUrl(base, facts.brand.logoAssetId),
              }
            : null,
        );
        return deps.queue(savepoint, {
          kind: 'invitation',
          ref: facts.invitationId,
          template: 'platform.invitation',
          templateVersion: rendered.version,
          locale: facts.locale,
          to: facts.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          sourceKey: facts.sourceKey,
        });
      });
      if (ticket) deps.schedule(() => deps.send(ticket));
    } catch (error) {
      // The worker's mailer still has the event: it sends the e-mail, only later.
      deps.warn('immediate invitation e-mail not queued; the worker will send it', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  };
}

function afterResponse(work: () => Promise<unknown>): void {
  try {
    after(work);
  } catch {
    // Outside a request scope (`after` refuses): send now, without waiting.
    void work().catch(() => undefined);
  }
}

/**
 * The web app's invitation e-mail: called by the invitation actions (apps/suite wires it with the role
 * catalogue) once the invitation and its code exist in the action's transaction.
 */
export const queueInvitationEmailInline = createInlineInvitationMailer({
  configured: () => inlineMailConfigured(),
  base: () => inlineMailBase(),
  prepare: prepareInlineInvitation,
  queue: queueInlineEmail,
  schedule: afterResponse,
  send: (ticket) =>
    sendInlineDelivery(
      {
        api: inlineMailApi as InlineMailApi,
        router: inlineEmailRouter(),
        log: (level, message, fields) => {
          log[level](message, { action: 'platform.email.inline', ...fields });
        },
      },
      ticket.id,
      ticket.secret,
    ),
  warn: (message, fields) => {
    log.warn(message, { action: 'platform.email.inline', ...fields });
  },
});
