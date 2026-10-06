import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';

/**
 * Message delivery log (ADR 0008 §7; migration 20261008090000): jobs queue an e-mail with its rendered
 * content, the send job claims it and records the outcome. Content and the plain address are removed by
 * the final update (the table refuses anything else). System claims only (the policy enforces it).
 */
export interface QueuedEmail {
  readonly template: string;
  readonly templateVersion: number;
  readonly locale: 'ar' | 'en';
  readonly recipientPersonId?: string | null;
  readonly destination: string;
  readonly destinationMasked: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly sourceEventId?: string | null;
}

export async function insertEmailDelivery(tx: ClaimsTx, email: QueuedEmail): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into platform.message_deliveries
      (template, template_version, locale, recipient_person_id, destination, destination_masked,
       subject, html_body, text_body, source_event_id)
    values (${email.template}, ${email.templateVersion}, ${email.locale},
            ${email.recipientPersonId ?? null}::uuid, ${email.destination}, ${email.destinationMasked},
            ${email.subject}, ${email.html}, ${email.text}, ${email.sourceEventId ?? null}::uuid)
    returning id`);
  if (!row) throw new Error('insertEmailDelivery: no row returned');
  return row.id;
}

export interface ClaimedEmail {
  readonly id: string;
  readonly destination: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Including this one. */
  readonly attempts: number;
}

/**
 * A delivery being sent is claimed again only after this long: its sender died or lost the database
 * (a send takes seconds; the transports time out well before).
 */
export const CLAIM_LEASE_SECONDS = 300;

/**
 * Marks a waiting delivery as being sent. `null` when it is final or unknown (a repeated job: nothing to
 * do); `'busy'` while another sender holds it (a duplicate event: try again later).
 */
export async function claimEmailDelivery(
  tx: ClaimsTx,
  id: string,
): Promise<ClaimedEmail | 'busy' | null> {
  const [current] = await tx.execute<{ status: string; leased: boolean }>(sql`
    select status, updated_at > now() - make_interval(secs => ${CLAIM_LEASE_SECONDS}) as leased
    from platform.message_deliveries
    where id = ${id}::uuid and channel = 'email'
    for update`);
  if (!current || (current.status !== 'queued' && current.status !== 'sending')) return null;
  if (current.status === 'sending' && current.leased) return 'busy';
  const [row] = await tx.execute<{
    id: string;
    destination: string;
    subject: string;
    html_body: string;
    text_body: string;
    attempts: number;
  }>(sql`
    update platform.message_deliveries set status = 'sending', attempts = attempts + 1
    where id = ${id}::uuid
    returning id, destination, subject, html_body, text_body, attempts`);
  if (!row) throw new Error('claimEmailDelivery: the delivery could not be claimed');
  return {
    id: row.id,
    destination: row.destination,
    subject: row.subject,
    html: row.html_body,
    text: row.text_body,
    attempts: row.attempts,
  };
}

export type DeliveryOutcome =
  | {
      readonly status: 'sent';
      readonly provider: string;
      readonly providerMessageId: string | null;
    }
  | { readonly status: 'failed' | 'suppressed'; readonly errorCode: string }
  /** A temporary failure: waits for the next attempt, content kept. */
  | { readonly status: 'retry'; readonly errorCode: string };

/**
 * Records the outcome of a claimed delivery. Throws when the delivery is no longer being sent (another
 * sender finished it, or the organization was suspended meanwhile): the job then retries, and its next
 * attempt finds the delivery finished, or discards it.
 */
export async function finishEmailDelivery(
  tx: ClaimsTx,
  id: string,
  outcome: DeliveryOutcome,
): Promise<void> {
  const updated = await (outcome.status === 'retry'
    ? tx.execute(sql`
        update platform.message_deliveries set status = 'queued', error_code = ${outcome.errorCode}
        where id = ${id}::uuid and status = 'sending'
        returning id`)
    : finish(tx, id, outcome));
  if (updated.length !== 1) {
    throw new Error('finishEmailDelivery: the delivery is no longer being sent');
  }
}

function finish(tx: ClaimsTx, id: string, outcome: Exclude<DeliveryOutcome, { status: 'retry' }>) {
  const sent = outcome.status === 'sent';
  return tx.execute(sql`
    update platform.message_deliveries
    set status = ${outcome.status},
        provider = ${sent ? outcome.provider : null},
        provider_message_id = ${sent ? outcome.providerMessageId : null},
        error_code = ${sent ? null : outcome.errorCode},
        sent_at = ${sent ? sql`now()` : sql`null`},
        destination = null, subject = null, html_body = null, text_body = null
    where id = ${id}::uuid and status in ('queued', 'sending')
    returning id`);
}

/**
 * The send job of a suspended or closed organization (its RLS hides the delivery): removes the waiting
 * delivery's content through `private.discard_inactive_tenant_delivery` (suppressed, TENANT_INACTIVE).
 * False when there was nothing to discard (already final, or the organization is active).
 */
export async function discardInactiveTenantDelivery(tx: ClaimsTx, id: string): Promise<boolean> {
  const [row] = await tx.execute<{ discarded: boolean }>(
    sql`select private.discard_inactive_tenant_delivery(${id}::uuid) as discarded`,
  );
  return row?.discarded === true;
}
