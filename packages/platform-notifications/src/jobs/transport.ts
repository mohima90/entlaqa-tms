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
