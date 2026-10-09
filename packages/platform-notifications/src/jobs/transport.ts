/** One message handed to a provider (ADR 0008 §2, e-mail channel). */
export interface OutgoingEmail {
  readonly from: { readonly name: string; readonly address: string };
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** The delivery id: providers that support it deduplicate repeated sends (retries). */
  readonly idempotencyKey: string;
}

export interface EmailTransport {
  readonly provider: 'resend' | 'smtp';
  send(email: OutgoingEmail): Promise<{ readonly providerMessageId: string | null }>;
  close?(): Promise<void>;
}

/**
 * Which transport and sender an organization's e-mail goes out with. R1: the platform's for every
 * organization. FR-NTF-11 (R2): the organization's own mail server (Resend, Mailgun, SMTP, Microsoft
 * Graph) when it has connected one, falling back to the platform's — a router per tenant, without
 * changes to the sender or to what queues e-mails.
 */
export interface EmailRoute {
  /** null: e-mail switched off (the delivery is recorded as suppressed). */
  readonly transport: EmailTransport | null;
  readonly from: OutgoingEmail['from'];
}

export type EmailRouter = (tenantId: string) => EmailRoute | Promise<EmailRoute>;

/**
 * A provider refused or could not take the message. `permanent`: retrying cannot help (address or
 * message rejected); otherwise the send job retries. `code` is ours (stable, no provider text: provider
 * messages may quote the address).
 */
export class EmailSendError extends Error {
  override readonly name = 'EmailSendError';
  constructor(
    readonly code: string,
    readonly permanent: boolean,
  ) {
    super(`e-mail not sent (${code})`);
  }
}
