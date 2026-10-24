import 'server-only';
import { describeUserAgent } from '@jadarat/platform-core';
import {
  type ClaimsTx,
  type InlineAccountMailApi,
  type InlineAccountMailSend,
  type InlineAccountMailTicket,
  inlineAccountMailApi,
  inlineMailApi,
  policyChangeOf,
  securityDigestOf,
  tagInlineAccountMail,
  MFA_REMOVAL_REASONS,
} from '@jadarat/platform-db';
import { renderEmail } from '@jadarat/platform-notifications';
import { brandAssetUrl, sendInlineDelivery } from '@jadarat/platform-notifications/inline';
import { log } from '@jadarat/platform-observability';
import { after } from 'next/server';
import {
  type AccountMailKind,
  type LockoutMailCaps,
  accountMailVerdict,
  composeAccountNotice,
  composeMfaSetUp,
  hashLinkToken,
  hashMfaSetupCode,
  newMfaRemoveToken,
  newMfaSetupCode,
} from './account-mail-compose';
import { PLATFORM_AUTH_LIMITS } from './auth-limits-config';
import { inlineEmailRouter, inlineMailBase, inlineMailConfigured } from './inline-mail';

/**
 * Account e-mails sent the moment the action commits (WP-ADM-05 follow-up; PO 23 Oct 2026: "every e-mail arrives
 * immediately" - the password changed, the authenticator set-up code and removal, the policy and lockout
 * notices). The action queues its account e-mail request as before and TAGS it in its own transaction
 * (`tagInlineAccountMail`); after the response this runner CLAIMS what was tagged with the request's secret,
 * writes the e-mail with the worker's own wording and caps (account-mail-compose.ts), queues the delivery and
 * removes the request in one step, and sends it under the lease it shares with the worker's sender
 * (sendInlineDelivery). The worker is the safety net at every step: a request nobody claimed is its own after
 * two minutes, a claimed one when the short lease ends, a delivery nobody finished by the rescue task; the
 * delivery's key is unique, so a message goes out once.
 *
 * Nothing here throws into the caller, and nothing is logged but codes: no address, no code, no secret. Where the
 * web app has no e-mail credentials nothing is tagged at all - the worker does it as before.
 */

export interface InlineAccountMailerDeps {
  readonly configured: () => boolean;
  readonly base: () => string | undefined;
  readonly api: InlineAccountMailApi;
  readonly tag: (tx: ClaimsTx) => Promise<InlineAccountMailTicket | null>;
  /** Runs `work` once the response has gone (the platform's `after()`); outside a request, right away. */
  readonly schedule: (work: () => Promise<unknown>) => void;
  /** Sends a queued delivery under the shared lease (never throws). */
  readonly deliver: (id: string, secret: Buffer) => Promise<unknown>;
  readonly lockoutMail: LockoutMailCaps;
  readonly log: (
    level: 'info' | 'warn' | 'error',
    message: string,
    fields?: Record<string, string | number>,
  ) => void;
  /** Most requests one web request sends (a policy change goes to every admin); the rest are the worker's. */
  readonly maxRequests?: number;
}

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code)) return code;
  return error instanceof Error && /^[A-Za-z]{2,64}$/.test(error.name) ? error.name : 'UNKNOWN';
};

export function createInlineAccountMailer(deps: InlineAccountMailerDeps) {
  const { api, log: logLine } = deps;
  const maxRequests = deps.maxRequests ?? 50;

  /** The e-mail of one claimed request: its template, language and rendered content (and the set-up hashes). */
  function compose(claim: InlineAccountMailSend, appBase: string) {
    const brand = claim.brand
      ? {
          actionColor: claim.brand.actionColor,
          linkColor: claim.brand.linkColor,
          logoUrl: brandAssetUrl(appBase, claim.brand.logoAssetId),
        }
      : null;
    if (claim.kind === 'mfa_factor_added') {
      if (!claim.factorId || !claim.setUpAt) {
        throw Object.assign(new Error('set-up without its app'), {
          code: 'FACTOR_GONE',
          temporary: false,
        });
      }
      const code = newMfaSetupCode();
      const remove = newMfaRemoveToken();
      const device = describeUserAgent(claim.setupUserAgent);
      const template = claim.platformSender
        ? 'platform.mfa_factor_added_platform'
        : 'platform.mfa_factor_added';
      const rendered = renderEmail(
        template,
        claim.locale,
        composeMfaSetUp({
          organizationName: claim.organizationName,
          loginEmail: claim.email,
          appBase,
          code,
          removeToken: remove,
          setUpAt: claim.setUpAt,
          browser: device.browser,
          system: device.system,
        }),
        brand,
      );
      return {
        template,
        rendered,
        codeHash: hashMfaSetupCode(claim.factorId, code),
        removeHash: hashLinkToken(remove),
      } as const;
    }
    if (claim.kind === 'security_digest') {
      // Digests are made by the worker (the database queues them untagged); never claimed here.
      throw Object.assign(new Error("digest is the worker's"), {
        code: 'NOT_INLINE',
        temporary: false,
      });
    }
    const reason = MFA_REMOVAL_REASONS.find((r) => r === claim.mfaReason) ?? null;
    const plan = composeAccountNotice({
      kind: claim.kind,
      organizationName: claim.organizationName,
      loginEmail: claim.email,
      appBase,
      lockMinutes: claim.lockMinutes,
      mfaReason: reason,
      policyChange: claim.kind === 'security_policy_changed' ? policyChangeOf(claim.detail) : null,
      changedByName: claim.changedByName,
      digest: securityDigestOf(claim.detail),
    });
    // renderEmail's generics want the template key and its variables together.
    const rendered = renderEmail(plan.template, claim.locale, plan.variables as never, brand);
    return {
      template: plan.template,
      rendered,
      codeHash: undefined,
      removeHash: undefined,
    } as const;
  }

  /** Claims and sends every request of the ticket (at most `maxRequests`); never throws. */
  async function run(ticket: InlineAccountMailTicket): Promise<void> {
    const base = deps.base();
    if (!base) return;
    const caps = deps.lockoutMail;
    for (let i = 0; i < maxRequests; i += 1) {
      let claim;
      try {
        claim = await api.claim(ticket.secret, caps.personQuietHours * 60);
      } catch (error) {
        logLine('warn', 'inline account e-mail: could not claim; the worker will send it', {
          reason: codeOf(error),
        });
        return;
      }
      if (claim.outcome === 'none') return;
      if (claim.outcome !== 'send') {
        // The database has answered the request already (nothing to send, or merged into the digest).
        logLine('info', `account e-mail not sent (${claim.kind}: ${claim.outcome})`);
        continue;
      }
      const kind: AccountMailKind = claim.kind;
      try {
        const verdict = accountMailVerdict(kind, claim, caps);
        if (!verdict.send) {
          await api.done(ticket.secret, claim.requestId);
          logLine('info', `account e-mail not sent (${kind}: ${verdict.reason})`);
          continue;
        }
        // Re-review N3: never dropped silently - sent, and the volume shows in the logs.
        if (verdict.overCap) {
          logLine('warn', `security notice over the hourly cap sent anyway (${kind})`);
        }
        const mail = compose(claim, base);
        const id = await api.queue(ticket.secret, claim.requestId, {
          template: mail.template,
          templateVersion: mail.rendered.version,
          locale: claim.locale,
          subject: mail.rendered.subject,
          html: mail.rendered.html,
          text: mail.rendered.text,
          ...(mail.codeHash ? { codeHash: mail.codeHash, removeHash: mail.removeHash } : {}),
        });
        if (id) await deps.deliver(id, ticket.secret);
        else logLine('info', `account e-mail not queued (${kind}: gone)`);
      } catch (error) {
        const permanent = (error as { temporary?: unknown } | null)?.temporary === false;
        if (permanent) {
          try {
            await api.done(ticket.secret, claim.requestId);
          } catch {
            // The lease runs out and the worker answers it.
          }
        }
        logLine('warn', `account e-mail not sent now (${kind}); the worker will handle it`, {
          reason: codeOf(error),
        });
      }
    }
  }

  async function tagTicket(tx: ClaimsTx): Promise<InlineAccountMailTicket | null> {
    if (!deps.configured() || !deps.base()) return null;
    try {
      return await tx.transaction((savepoint) => deps.tag(savepoint));
    } catch (error) {
      logLine('warn', 'immediate account e-mail not started; the worker will send it', {
        reason: codeOf(error),
      });
      return null;
    }
  }

  return {
    run,
    /** Runs `ticket` once the response has gone. */
    schedule(ticket: InlineAccountMailTicket | null): void {
      if (!ticket) return;
      deps.schedule(() => run(ticket));
    },
    /**
     * In the action's transaction, after it queued its account e-mail request(s): tags them and schedules the
     * immediate send. A savepoint: nothing here may spoil the action's own transaction; on any failure the worker
     * sends the e-mail as before.
     */
    async tagInTransaction(tx: ClaimsTx): Promise<void> {
      const ticket = await tagTicket(tx);
      if (ticket) deps.schedule(() => run(ticket));
    },
    /**
     * The same tagging, returning the key to send with (the action runtime sends it after the commit). Null:
     * nothing was queued, or the web app cannot send (the worker does it).
     */
    tagTicket,
    /** For an anonymous request that tagged its own request in its own transaction (`inline: true`). */
    configured: () => deps.configured() && deps.base() !== undefined,
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

/** The web app's account e-mail sender over its environment. */
export const inlineAccountMailer = createInlineAccountMailer({
  configured: () => inlineMailConfigured(),
  base: () => inlineMailBase(),
  api: inlineAccountMailApi,
  tag: tagInlineAccountMail,
  schedule: afterResponse,
  deliver: (id, secret) =>
    sendInlineDelivery(
      {
        api: inlineMailApi,
        router: inlineEmailRouter(),
        log: (level, message, fields) => {
          log[level](message, { action: 'platform.email.inline', ...fields });
        },
      },
      id,
      secret,
    ),
  lockoutMail: PLATFORM_AUTH_LIMITS.lockoutMail,
  log: (level, message, fields) => {
    log[level](message, { action: 'platform.email.inline', ...fields });
  },
});
