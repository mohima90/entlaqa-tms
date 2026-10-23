import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthMailApi } from '@jadarat/platform-db';
import { renderEmail } from '@jadarat/platform-notifications';
import { type InlineEmailSender, brandAssetUrl } from '@jadarat/platform-notifications/inline';

/**
 * Supabase Auth's Send Email hook (WP-ADM-05; PO 23 Oct 2026: e-mails arrive immediately, "the way Kawadir sends
 * them straight from Vercel"). With the hook enabled, Auth hands EVERY e-mail it would send to the app's route
 * (POST /api/auth/send-email) instead of its own mailer. This module is the framework-free part: it verifies the
 * signature (the standard-webhooks scheme Supabase uses), decides per e-mail type and sends the one e-mail the
 * app uses Auth for - the sign-in code - at once through the organization's sender, or the platform sender when
 * the account belongs to several organizations or holds a platform role (security review M1).
 *
 * Every other type is REFUSED (HTTP 400, nothing sent), so enabling the hook breaks nothing that works today:
 *   magiclink          the sign-in code (signInWithOtp)                                  -> sent here
 *   recovery           password reset - PASSWORD_RESET_DELIVERY=worker: the worker mails it with an admin
 *                      link and Auth sends nothing; `auth` is switched to `worker` while the hook is on
 *                      (readPasswordResetDelivery), so this type never arrives
 *   signup / invite    invitations are the app's own (sign-up with auto-confirm, "Confirm email" off)
 *   email_change /     the app has neither flow
 *   reauthentication
 * A refusal logs the type (never the address). The hook secret signs the call: without a valid signature
 * nothing is read or sent.
 */

/** How far a signed timestamp may be from now (standard-webhooks recommends five minutes). */
export const HOOK_TIMESTAMP_TOLERANCE_S = 5 * 60;

/** How long the code lives in Auth (otp_expiry 600 s), as told in the e-mail. */
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

/** The key bytes of `v1,whsec_<base64>` / `whsec_<base64>` / `<base64>`. */
function keyOf(secret: string): Buffer {
  const trimmed = secret.trim();
  const withoutVersion = trimmed.startsWith('v1,') ? trimmed.slice(3) : trimmed;
  const base64 = withoutVersion.startsWith('whsec_') ? withoutVersion.slice(6) : withoutVersion;
  return Buffer.from(base64, 'base64');
}

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
  const key = keyOf(secret);
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
  readonly token: string;
  readonly type: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The few fields the hook uses, checked; null for anything else (the body comes from another service). */
function readBody(raw: string): HookBody | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const user = (value as { user?: { id?: unknown; email?: unknown } } | null)?.user;
  const data = (value as { email_data?: { token?: unknown; email_action_type?: unknown } } | null)
    ?.email_data;
  if (
    typeof user?.id !== 'string' ||
    !UUID.test(user.id) ||
    typeof user.email !== 'string' ||
    user.email.length < 3 ||
    user.email.length > 320 ||
    typeof data?.token !== 'string' ||
    data.token.length > 64 ||
    typeof data.email_action_type !== 'string' ||
    data.email_action_type.length > 40
  ) {
    return null;
  }
  return {
    userId: user.id,
    userEmail: user.email,
    token: data.token,
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
  if (type !== 'magiclink') {
    // Refused safely: nothing is sent, nothing breaks that worked before (see the list above).
    deps.log('warn', 'send-email hook: e-mail type not handled', { type });
    return failure(400, 'this e-mail type is not sent by this application');
  }
  const code = parsed.token;
  if (!/^[0-9]{6}$/.test(code)) {
    deps.log(
      'error',
      'send-email hook: the sign-in code is not six digits (check Auth OTP length)',
    );
    return failure(400, 'unexpected code');
  }
  try {
    const account = await deps.api.account(parsed.userId);
    // An account Auth knows but we cannot write to (banned, no usable membership): nothing is sent; the
    // answer is a success so that Auth's reply to the caller does not tell either.
    if (account?.email.toLowerCase() !== parsed.userEmail.trim().toLowerCase()) {
      deps.log('info', 'send-email hook: sign-in code not sent (no usable account)');
      return ok();
    }
    const found = await deps.api.route(account.tenantId);
    if (!found) {
      deps.log('info', 'send-email hook: sign-in code not sent (organization not served)');
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
    const code = (error as { code?: unknown } | null)?.code;
    deps.log('error', 'send-email hook: sign-in code not sent', {
      reason: typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code) ? code : 'unknown',
    });
    return failure(500, 'the e-mail could not be sent');
  }
}
