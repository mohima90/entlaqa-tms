import { type HttpProviderOptions, postToProvider } from './http-provider';
import { EmailSendError, type EmailTransport } from './transport';

export const MICROSOFT_LOGIN_ORIGIN = 'https://login.microsoftonline.com';
export const MICROSOFT_GRAPH_ORIGIN = 'https://graph.microsoft.com';

/** A token is used until 5 minutes before it expires. */
const TOKEN_MARGIN_MS = 5 * 60_000;

/**
 * Microsoft 365 through Microsoft Graph (WP-ADM-01; Kawadir's microsoft_graph provider): the OAuth 2.0
 * client-credentials flow of an app registration in the organization's Microsoft Entra tenant (tenant id,
 * client id, client secret; application permission Mail.Send with admin consent), then `sendMail` AS the
 * sender address — a mailbox of that tenant. For tenants that switched SMTP AUTH off. The access token is kept
 * in memory for this transport only (never logged or stored). Graph's JSON message has one body: the HTML
 * version is sent (the plain-text version is not supported by sendMail's JSON form). No idempotency key.
 */
export function createMicrosoftGraphTransport(
  options: {
    readonly tenantId: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly now?: () => number;
  } & HttpProviderOptions,
): EmailTransport {
  const now = options.now ?? Date.now;
  let token: { readonly value: string; readonly expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - TOKEN_MARGIN_MS > now()) return token.value;
    const response = await postToProvider(
      `${MICROSOFT_LOGIN_ORIGIN}/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`,
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: options.clientId,
          client_secret: options.clientSecret,
          scope: `${MICROSOFT_GRAPH_ORIGIN}/.default`,
        }).toString(),
      },
      options,
      // A wrong tenant, client or secret answers 400/401 (invalid_client, unauthorized_client…): the
      // configuration, never the message.
      (response) =>
        Promise.resolve(
          response.status === 400 || response.status === 401
            ? new EmailSendError('PROVIDER_AUTH', false)
            : null,
        ),
    );
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof body.access_token !== 'string' || body.access_token === '') {
      throw new EmailSendError('PROVIDER_AUTH', false);
    }
    const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    token = { value: body.access_token, expiresAt: now() + seconds * 1000 };
    return token.value;
  }

  return {
    provider: 'microsoft_graph',
    async send(email) {
      const bearer = await accessToken();
      await postToProvider(
        `${MICROSOFT_GRAPH_ORIGIN}/v1.0/users/${encodeURIComponent(email.from.address)}/sendMail`,
        {
          headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              subject: email.subject,
              body: { contentType: 'HTML', content: email.html },
              from: { emailAddress: { address: email.from.address, name: email.from.name } },
              toRecipients: [{ emailAddress: { address: email.to } }],
              ...(email.replyTo ? { replyTo: [{ emailAddress: { address: email.replyTo } }] } : {}),
            },
            saveToSentItems: false,
          }),
        },
        options,
        async (response) => {
          if (response.status === 401) token = null; // an expired or revoked token: a new one next time
          if (response.status === 404) {
            // The sender address is no mailbox of the tenant (or the app may not use it): the configuration.
            return new EmailSendError('SENDER_NOT_ALLOWED', false);
          }
          return Promise.resolve(null);
        },
      );
      return { providerMessageId: null };
    },
  };
}
