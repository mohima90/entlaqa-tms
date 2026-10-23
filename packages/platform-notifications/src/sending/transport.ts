import 'server-only';
import type { EmailProviderId } from '../providers';

/** One message handed to a provider (ADR 0008 §2, e-mail channel). */
export interface OutgoingEmail {
  readonly from: { readonly name: string; readonly address: string };
  readonly to: string;
  /** The organization's reply-to address (Email integration), if any. */
  readonly replyTo?: string | undefined;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** The delivery id: providers that support it deduplicate repeated sends (retries). */
  readonly idempotencyKey: string;
}

export interface EmailTransport {
  readonly provider: EmailProviderId;
  send(email: OutgoingEmail): Promise<{ readonly providerMessageId: string | null }>;
  close?(): Promise<void>;
}

/** Whose sender a message goes out with (recorded with the delivery: message_deliveries.sender). */
export type EmailSenderKind = 'organization' | 'platform' | 'installation';

/**
 * Which transport and sender an organization's e-mail goes out with — the sender rule (WP-ADM-01, FR-NTF-11;
 * Kawadir): the organization's own provider when configured and enabled, else the platform sender once
 * verified (with the organization's brand name as display name), else — self-hosted installations only — the
 * installation's sender from the worker's environment. Nothing ready: the message WAITS in the queue (`wait`,
 * with the reason recorded) until a sender is ready; it is never dropped and never sent through another
 * organization's provider, and an organization's failing provider is never replaced by the platform sender.
 */
export type EmailRoute =
  | {
      readonly kind: 'send';
      readonly transport: EmailTransport;
      readonly from: OutgoingEmail['from'];
      readonly replyTo?: string | undefined;
      readonly sender: EmailSenderKind;
    }
  | { readonly kind: 'wait'; readonly code: 'NO_SENDER' | 'CREDENTIALS_UNAVAILABLE' };

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
