import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthMailApi, InlineRecoveryApi } from '@jadarat/platform-db';
import { isSafeLink, renderEmail } from '@jadarat/platform-notifications';
import { type InlineEmailSender, brandAssetUrl } from '@jadarat/platform-notifications/inline';
import { composeReset } from './account-mail-compose';
import { generateSignInCode, hookSecretBytes, sealTokenHash } from './sign-in-code-seal';
import type { SendEmailHookLimiter } from './sign-in-code-limits';

/**
 * Supabase Auth's Send Email hook (WP-ADM-05; PO 23 Oct 2026: e-mails arrive immediately, "the way Kawadir sends
 * them straight from Vercel"). With the hook enabled, Auth hands EVERY e-mail it would send to the app's route
 * (POST /api/auth/send-email) instead of its own mailer. This module is the framework-free part: it verifies the
 * signature (the standard-webhooks scheme Supabase uses), decides per e-mail type and sends the one e-mail the
 * app uses Auth for - the sign-in code - at once through the organization's sender, or the platform sender when
 * the account belongs to several organizations or holds a platform role (security review M1).
 *
 * THE CODE IS OURS (security re-review H1). Auth's one-time password is long (10 digits) and is NEVER e-mailed:
 * a short code Auth would accept could be guessed against Auth's public /verify, where none of our limiters
 * runs. The hook makes its own six-digit code, stores its keyed hash with Auth's `token_hash` (encrypted here,
 * with a key the database never sees) and e-mails OUR code; the check is ours (private.verify_sign_in_code
 * behind the limiters), and only a right code releases the token hash that opens the session. See
 * docs/engineering/sign-in-protection.md §12.
 *
 * The hook has limits of its own (M-A): a webhook id is acted on once within five minutes (L1), and an account
 * is e-mailed at most 10 codes per 15 minutes and 40 a day (Auth's public /otp does not pass the app's request
 * limits); over the limit nothing is sent and the skip is logged.
 *
 * THE PASSWORD RESET (type recovery; PO 23 Oct 2026: "forgot password" arrives at once too). Auth has created the
 * recovery token already and hands its `token_hash` to the hook; the link is the one the reset page has always
 * taken (`/reset-password#token_hash=...&type=recovery`, the token in the fragment), so the page and its
 * completion are unchanged and NO Auth admin key is needed in the web tier. The hook counts what it e-mails per
 * account (5 per 15 minutes, 20 a day; Auth's public /recover does not pass the app's request limits), reads the
 * account's facts, and queues the e-mail as a DELIVERY (the database allows five an hour per person and only the
 * account's own address) that the web app sends right after answering Auth - the worker is the safety net for
 * one nobody finished. Every outcome but a database failure is answered with success, so the hook's answer
 * (and its short time) does not tell whether an account exists. Without the `recovery` dependency the type is
 * refused as before.
 *
 * Every other type is REFUSED (HTTP 400, nothing sent), so enabling the hook breaks nothing that works today:
 *   magiclink          the sign-in code (signInWithOtp)                                  -> sent here
 *   recovery           the password reset                                                -> queued here, sent at once
 *   signup / invite    invitations are the app's own (sign-up with auto-confirm, "Confirm email" off)
 *   email_change /     the app has neither flow
 *   reauthentication
 * A refusal logs the type (never the address). The hook secret signs the call: without a valid signature
 * nothing is read or sent.
 */

/** How far a signed timestamp may be from now (standard-webhooks recommends five minutes). */
export const HOOK_TIMESTAMP_TOLERANCE_S = 5 * 60;

/** How long our code lives (the database's rule: 10 minutes), as told in the e-mail. */
export const SIGN_IN_CODE_VALID_MINUTES = 10;

export interface HookRequest {
  /** The raw body, exactly as received (the signature covers its bytes). */
  readonly body: string;
  readonly webhookId: string | null;
  readonly webhookTimestamp: string | null;
  readonly webhookSignature: string | null;
}

export interface HookResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface AuthEmailHookDeps {
  /** SEND_EMAIL_HOOK_SECRET as Supabase shows it (`v1,whsec_<base64>`; the bare base64 is accepted too). */
  readonly secret: string | undefined;
  /** Public origin of the web app (APP_BASE_URL): the organization's logo is linked from there. */
  readonly appBaseUrl: string | undefined;
  readonly api: AuthMailApi;
  readonly sender: InlineEmailSender;
  readonly limiter: SendEmailHookLimiter;
  /**
   * The password reset (type recovery): the database side, how to run the send once Auth has its answer, and
   * how to send a queued delivery. Absent: the type is refused.
   */
  readonly recovery?:
    | {
        readonly api: InlineRecoveryApi;
        readonly schedule: (work: () => Promise<unknown>) => void;
        readonly deliver: (ticket: {
          readonly id: string;
          readonly secret: Buffer;
        }) => Promise<unknown>;
      }
    | undefined;
  /** Six random digits; replaced in tests. */
  readonly generateCode?: (() => string) | undefined;
  readonly now: () => number;
  readonly log: (
    level: 'info' | 'warn' | 'error',
    message: string,
    fields?: Record<string, string | number>,
  ) => void;
}

const failure = (status: number, message: string): HookResponse => ({
  status,
  // Auth's documented error shape for a hook: it shows the message to whoever caused the e-mail.
  body: { error: { http_code: status, message } },
});

const ok = (): HookResponse => ({ status: 200, body: {} });

/**
 * standard-webhooks: HMAC-SHA-256 over `id.timestamp.body` with the decoded secret, base64, sent as
 * `v1,<signature>` (several, space separated, during a rotation). Constant-time comparison; a timestamp more
 * than five minutes off is refused (replays).
 */
export function verifyHookSignature(secret: string, request: HookRequest, nowMs: number): boolean {
  const { webhookId, webhookTimestamp, webhookSignature } = request;
  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;
  if (!/^\d{1,12}$/.test(webhookTimestamp)) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - Number(webhookTimestamp)) > HOOK_TIMESTAMP_TOLERANCE_S) {
    return false;
  }
  const key = hookSecretBytes(secret);
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key)
    .update(`${webhookId}.${webhookTimestamp}.${request.body}`)
    .digest();
  for (const candidate of webhookSignature.split(' ')) {
    const [version, signature] = candidate.split(',');
    if (version !== 'v1' || !signature) continue;
    const given = Buffer.from(signature, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

interface HookBody {
  readonly userId: string;
  readonly userEmail: string;
  readonly tokenHash: string;
  readonly type: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Auth's token hash: printable, no spaces (it is hex today); bounded so that sealing it fits the column. */
const TOKEN_HASH = /^[\x21-\x7e]{16,200}$/;

/** The few fields the hook uses, checked; null for anything else (the body comes from another service). */
function readBody(raw: string): HookBody | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const user = (value as { user?: { id?: unknown; email?: unknown } } | null)?.user;
  const data = (
    value as { email_data?: { token_hash?: unknown; email_action_type?: unknown } } | null
  )?.email_data;
  if (
    typeof user?.id !== 'string' ||
    !UUID.test(user.id) ||
    typeof user.email !== 'string' ||
    user.email.length < 3 ||
    user.email.length > 320 ||
    typeof data?.email_action_type !== 'string' ||
    data.email_action_type.length > 40
  ) {
    return null;
  }
  return {
    userId: user.id,
    userEmail: user.email,
    // Only needed for the type that is sent; checked there.
    tokenHash: typeof data.token_hash === 'string' ? data.token_hash : '',
    type: data.email_action_type,
  };
}

/** Handles one call of Auth's Send Email hook. Never throws; the answer carries no address and no code. */
export async function handleSendEmailHook(
  deps: AuthEmailHookDeps,
  request: HookRequest,
): Promise<HookResponse> {
  const { secret } = deps;
  if (!secret || secret.trim() === '') {
    deps.log('error', 'send-email hook called but SEND_EMAIL_HOOK_SECRET is not set');
    return failure(503, 'not configured');
  }
  if (!verifyHookSignature(secret, request, deps.now())) {
    deps.log('warn', 'send-email hook: signature refused');
    return failure(401, 'invalid signature');
  }
  const parsed = readBody(request.body);
  if (!parsed) {
    deps.log('warn', 'send-email hook: unreadable body');
    return failure(400, 'unreadable request');
  }
  const { type } = parsed;
  if (type === 'recovery' && deps.recovery) {
    return handleRecovery(deps, deps.recovery, request, parsed);
  }
  if (type !== 'magiclink') {
    // Refused safely: nothing is sent, nothing breaks that worked before (see the list above).
    deps.log('warn', 'send-email hook: e-mail type not handled', { type });
    return failure(400, 'this e-mail type is not sent by this application');
  }
  if (!TOKEN_HASH.test(parsed.tokenHash)) {
    deps.log('error', 'send-email hook: Auth sent no usable token hash');
    return failure(400, 'unexpected request');
  }
  // `verifyHookSignature` accepted the call, so the id is present.
  const webhookId = request.webhookId ?? '';
  let claimed = false;
  try {
    // L1: the same signed call is acted on once within five minutes (a replay is answered, not repeated).
    if (!(await deps.limiter.claimWebhook(webhookId))) {
      deps.log('info', 'send-email hook: repeated call ignored');
      return ok();
    }
    claimed = true;
    // M-A: Auth's public /otp does not pass the app's request limits; the hook counts what it e-mails.
    if (!(await deps.limiter.allowSend(parsed.userId))) {
      deps.log('warn', 'send-email hook: sign-in code not sent (too many codes for this account)');
      return ok();
    }
    const sealed = sealTokenHash(secret, parsed.userId, parsed.tokenHash);
    if (!sealed) {
      deps.log('error', 'send-email hook: the token hash could not be sealed');
      await deps.limiter.releaseWebhook(webhookId);
      return failure(503, 'not configured');
    }
    const code = (deps.generateCode ?? generateSignInCode)();
    const issued = await deps.api.issue({
      userId: parsed.userId,
      code,
      sealedTokenHash: sealed,
      actionType: 'magiclink',
    });
    // An account Auth knows but we cannot write to (banned, no usable membership, an unserved organization):
    // nothing was stored, nothing is sent; the answer is a success so that Auth's reply does not tell either.
    if (!issued) {
      deps.log('info', 'send-email hook: sign-in code not sent (no usable account)');
      return ok();
    }
    const { account, route: found } = issued;
    if (account.email.toLowerCase() !== parsed.userEmail.trim().toLowerCase()) {
      deps.log('info', 'send-email hook: sign-in code not sent (another address)');
      return ok();
    }
    const brand = found.brand
      ? {
          actionColor: found.brand.actionColor,
          linkColor: found.brand.linkColor,
          logoUrl: brandAssetUrl(deps.appBaseUrl, found.brand.logoAssetId),
        }
      : null;
    const email = renderEmail(
      'platform.sign_in_code',
      account.locale,
      {
        organizationName: { ar: found.route.brandNameAr, en: found.route.brandNameEn },
        code,
        validMinutes: SIGN_IN_CODE_VALID_MINUTES,
        loginEmail: account.email,
      },
      brand,
    );
    const { sender } = await deps.sender.send({
      row: found.route,
      tenantId: account.tenantId,
      platformOnly: account.platformSender,
      to: account.email,
      email,
    });
    deps.log('info', 'send-email hook: sign-in code sent', { sender });
    try {
      await deps.api.auditSent(parsed.userId, account.tenantId);
    } catch {
      deps.log('warn', 'send-email hook: could not audit the sent code');
    }
    return ok();
  } catch (error) {
    // A code only (EmailSendError.code, a database error name): never the provider's message or the address.
    const reason = (error as { code?: unknown } | null)?.code;
    deps.log('error', 'send-email hook: sign-in code not sent', {
      reason:
        typeof reason === 'string' && /^[A-Z0-9_]{2,64}$/.test(reason)
          ? reason
          : error instanceof Error && /^[A-Za-z]{2,64}$/.test(error.name)
            ? error.name
            : 'unknown',
    });
    // A failed call may be retried: its id is given back.
    if (claimed) await deps.limiter.releaseWebhook(webhookId);
    return failure(500, 'the e-mail could not be sent');
  }
}

/** The link's token hash: only characters that are safe in the reset URL's fragment (the page checks the same). */
const RECOVERY_TOKEN_HASH = /^[A-Za-z0-9_-]{16,128}$/;

type RecoveryDeps = NonNullable<AuthEmailHookDeps['recovery']>;

/** The PostgreSQL error code of a failure, also when the driver or the ORM wraps it (`cause`). */
function pgCodeOf(error: unknown): string | null {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Type recovery: queue the reset e-mail for the account Auth is e-mailing and send it once Auth has its answer.
 * Success for every outcome that is not a failure of ours (no usable account, over a limit, a repeat call).
 */
async function handleRecovery(
  deps: AuthEmailHookDeps,
  recovery: RecoveryDeps,
  request: HookRequest,
  parsed: HookBody,
): Promise<HookResponse> {
  // Trailing slashes trimmed without a backtracking regular expression (CodeQL js/polynomial-redos).
  let base = deps.appBaseUrl?.trim() ?? '';
  while (base.endsWith('/')) base = base.slice(0, -1);
  if (base === '' || !isSafeLink(base)) {
    deps.log(
      'error',
      'send-email hook: reset e-mail not sent (APP_BASE_URL is not a usable origin)',
    );
    return ok();
  }
  if (!RECOVERY_TOKEN_HASH.test(parsed.tokenHash)) {
    deps.log('error', 'send-email hook: Auth sent no usable recovery token hash');
    return ok();
  }
  // `verifyHookSignature` accepted the call, so the id is present.
  const webhookId = request.webhookId ?? '';
  let claimed = false;
  try {
    if (!(await deps.limiter.claimWebhook(webhookId))) {
      deps.log('info', 'send-email hook: repeated call ignored');
      return ok();
    }
    claimed = true;
    if (!(await deps.limiter.allowSend(parsed.userId, 'password_reset'))) {
      deps.log('warn', 'send-email hook: reset e-mail not sent (too many for this account)');
      return ok();
    }
    const facts = await recovery.api.facts(parsed.userId);
    // Nothing for an account Auth knows but we cannot write to (banned, no usable membership): the answer does
    // not tell.
    if (!facts) {
      deps.log('info', 'send-email hook: reset e-mail not sent (no usable account)');
      return ok();
    }
    if (facts.email.toLowerCase() !== parsed.userEmail.trim().toLowerCase()) {
      deps.log('info', 'send-email hook: reset e-mail not sent (another address)');
      return ok();
    }
    const template = facts.platformSender
      ? 'platform.password_reset_platform'
      : 'platform.password_reset';
    const email = renderEmail(
      template,
      facts.locale,
      composeReset({
        organizationName: facts.organizationName,
        loginEmail: facts.email,
        appBase: base,
        tokenHash: parsed.tokenHash,
        codeNeeded: facts.hasApp,
      }),
      facts.brand
        ? {
            actionColor: facts.brand.actionColor,
            linkColor: facts.brand.linkColor,
            logoUrl: brandAssetUrl(base, facts.brand.logoAssetId),
          }
        : null,
    );
    const ticket = await recovery.api.queue({
      userId: parsed.userId,
      template,
      templateVersion: email.version,
      locale: facts.locale,
      to: facts.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      // One delivery per signed call: the webhook id, hashed (it is Auth's, and mixed-case).
      sourceKey: `recovery:${createHash('sha256').update(webhookId).digest('hex').slice(0, 32)}`,
    });
    if (!ticket) {
      deps.log(
        'info',
        'send-email hook: reset e-mail not queued (over the hourly cap or queued already)',
      );
      return ok();
    }
    // After Auth has its answer: the send takes as long as the provider takes; the worker is the safety net.
    recovery.schedule(() => recovery.deliver(ticket));
    deps.log('info', 'send-email hook: reset e-mail queued');
    return ok();
  } catch (error) {
    // An app deployed before its migration (security review M1): the function or a column is not there yet.
    // Not sent, and Auth is answered with success (a 500 would tell which accounts exist); the code only is logged.
    const missing = pgCodeOf(error);
    if (missing === '42883' || missing === '42703') {
      deps.log(
        'error',
        'send-email hook: reset e-mail not sent (the database is not migrated yet)',
        {
          reason: missing,
        },
      );
      if (claimed) await deps.limiter.releaseWebhook(webhookId);
      return ok();
    }
    const reason = (error as { code?: unknown } | null)?.code;
    deps.log('error', 'send-email hook: reset e-mail not queued', {
      reason:
        typeof reason === 'string' && /^[A-Z0-9_]{2,64}$/.test(reason)
          ? reason
          : error instanceof Error && /^[A-Za-z]{2,64}$/.test(error.name)
            ? error.name
            : 'unknown',
    });
    if (claimed) await deps.limiter.releaseWebhook(webhookId);
    return failure(500, 'the e-mail could not be sent');
  }
}
