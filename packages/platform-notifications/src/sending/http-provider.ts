import 'server-only';
import { EmailSendError } from './transport';

/** What every HTTP provider adapter can be given (tests replace the network and the clock). */
export interface HttpProviderOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_MAX_WAIT_MS = 10_000;

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * One POST to a provider's HTTP API with the shared rules of the HTTP adapters (SendGrid, Mailgun, Microsoft
 * Graph; Resend keeps its own for its error names): a network failure or timeout is temporary
 * (NETWORK_ERROR); a rate limit (429) is waited out in place (Retry-After, capped at 10 s, with jitter) at
 * most twice, then left to the job's retries (RATE_LIMITED); 401/403 is the configuration (PROVIDER_AUTH —
 * fixing the key or the sender lets the waiting messages go out); 5xx is temporary (PROVIDER_UNAVAILABLE);
 * any other refusal is final for this message (PROVIDER_REJECTED). Response bodies are never kept: they may
 * quote addresses.
 */
export async function postToProvider(
  url: string,
  init: { readonly headers: Record<string, string>; readonly body: string },
  options: HttpProviderOptions,
  classify?: (response: Response) => Promise<EmailSendError | null>,
): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? pause;
  const random = options.random ?? Math.random;
  for (let retry = 0; ; retry += 1) {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'user-agent': 'jadarat-worker', ...init.headers },
        body: init.body,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch {
      throw new EmailSendError('NETWORK_ERROR', false);
    }
    if (response.ok) return response;
    const special = classify ? await classify(response) : null;
    if (special) throw special;
    if (response.status === 401 || response.status === 403) {
      throw new EmailSendError('PROVIDER_AUTH', false);
    }
    if (response.status === 429) {
      if (retry < RATE_LIMIT_RETRIES) {
        const seconds = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
        await sleep(Math.min(wait, RATE_LIMIT_MAX_WAIT_MS) + Math.floor(random() * 500));
        continue;
      }
      throw new EmailSendError('RATE_LIMITED', false);
    }
    if (response.status >= 500) throw new EmailSendError('PROVIDER_UNAVAILABLE', false);
    throw new EmailSendError('PROVIDER_REJECTED', true);
  }
}

/** A provider's message id from a header or JSON field, at most 300 characters. */
export function messageId(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value.slice(0, 300) : null;
}
