import { EmailSendError, type EmailTransport, type OutgoingEmail } from './transport';

export const RESEND_API_URL = 'https://api.resend.com/emails';

/** Display names are quoted in the From header; characters that would break it are dropped. */
export function formatFrom(from: OutgoingEmail['from']): string {
  const name = from.name.replace(/["\\<>\r\n]/g, '').trim();
  return name ? `"${name}" <${from.address}>` : from.address;
}

const RESEND_NAME = /^[a-z][a-z0-9_]{1,62}$/;

/** Resend's error names that a retry can fix; every other 4xx refusal is final for this message. */
const RETRYABLE_NAMES = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'concurrent_idempotent_requests',
  'internal_server_error',
  'application_error',
]);

/**
 * Rate limits clear within seconds: the transport waits (Retry-After, capped, with jitter) and tries
 * again in place, so a burst of messages does not use up their job attempts, which would all retry at
 * the same moments (graphile-worker's back-off has no jitter).
 */
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_MAX_WAIT_MS = 10_000;

function rateLimitWait(response: Response, random: () => number): number {
  const seconds = Number(response.headers.get('retry-after'));
  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
  return Math.min(wait, RATE_LIMIT_MAX_WAIT_MS) + Math.floor(random() * 500);
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function errorName(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { name?: unknown };
    return typeof body.name === 'string' && RESEND_NAME.test(body.name) ? body.name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resend's HTTP API (regional cloud, PO decision 6 Oct 2026). The delivery id is the Idempotency-Key:
 * Resend returns the first result for a repeated request within 24 hours, so a retry after a lost
 * response does not send twice.
 */
export function createResendTransport(options: {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}): EmailTransport {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? pause;
  const random = options.random ?? Math.random;
  const post = async (email: OutgoingEmail): Promise<Response> => {
    try {
      return await doFetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': email.idempotencyKey,
          'user-agent': 'jadarat-worker',
        },
        body: JSON.stringify({
          from: formatFrom(email.from),
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch {
      throw new EmailSendError('NETWORK_ERROR', false);
    }
  };
  return {
    provider: 'resend',
    async send(email) {
      for (let retry = 0; ; retry += 1) {
        const response = await post(email);
        if (response.ok) {
          const body = (await response.json().catch(() => ({}))) as { id?: unknown };
          return { providerMessageId: typeof body.id === 'string' ? body.id.slice(0, 300) : null };
        }
        const name = await errorName(response);
        const code = name ? name.toUpperCase() : `HTTP_${String(response.status)}`;
        if (response.status === 401 || response.status === 403) {
          // A wrong or restricted key, or a sender outside the verified domain: fixing the
          // configuration lets the queued messages go out.
          throw new EmailSendError('PROVIDER_AUTH', false);
        }
        if (
          response.status === 429 &&
          (name === undefined || name === 'rate_limit_exceeded') &&
          retry < RATE_LIMIT_RETRIES
        ) {
          await sleep(rateLimitWait(response, random));
          continue;
        }
        if (
          response.status === 429 ||
          response.status >= 500 ||
          (name && RETRYABLE_NAMES.has(name))
        ) {
          throw new EmailSendError(code, false);
        }
        // Includes 409 invalid_idempotent_request: the same delivery was sent before with other
        // content (the sender settings changed between attempts) — it may have arrived (runbook).
        throw new EmailSendError(code, true);
      }
    },
  };
}
