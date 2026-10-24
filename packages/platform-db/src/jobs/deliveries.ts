import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';
import { pgError } from '../pg-error';

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
  /** Whose sender it goes out with (message_deliveries.sender, WP-ADM-01), recorded with the claim. */
  sender?: 'organization' | 'platform' | 'installation',
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
  if (sender) await recordSender(tx, id, sender);
  return {
    id: row.id,
    destination: row.destination,
    subject: row.subject,
    html: row.html_body,
    text: row.text_body,
    attempts: row.attempts,
  };
}

/**
 * The sender column arrives with migration 20261022100000 (expand-first: the worker may run before it): in a
 * savepoint, and skipped while the column does not exist.
 */
async function recordSender(tx: ClaimsTx, id: string, sender: string): Promise<void> {
  try {
    await tx.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        update platform.message_deliveries set sender = ${sender}
        where id = ${id}::uuid and status = 'sending'`);
    });
  } catch (error) {
    if (pgError(error)?.code !== '42703') throw error;
  }
}

/** The template of a delivery that is not final (null: final or unknown). */
export async function getEmailDeliveryTemplate(tx: ClaimsTx, id: string): Promise<string | null> {
  const [row] = await tx.execute<{ template: string }>(sql`
    select template from platform.message_deliveries
    where id = ${id}::uuid and channel = 'email' and status in ('queued', 'sending')`);
  return row?.template ?? null;
}

export type DeliveryOutcome =
  | {
      readonly status: 'sent';
      readonly provider: string;
      readonly providerMessageId: string | null;
    }
  | {
      readonly status: 'failed' | 'suppressed';
      readonly errorCode: string;
      /** The provider that refused it (an organization's own provider's errors are shown to its admins). */
      readonly provider?: string | null;
    }
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
        provider = ${outcome.provider ?? null},
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

/**
 * Has the web app already queued a message for this source (`invitation:<id>:<code number>`)? The worker's
 * mailers skip it then (WP-ADM-05 follow-up: e-mail sent the moment the action commits). Always false before
 * migration 20261026110000 (the worker may run ahead of the database): in a savepoint, so the caller's
 * transaction stays usable.
 */
export async function inlineDeliveryExists(tx: ClaimsTx, sourceKey: string): Promise<boolean> {
  try {
    return await tx.transaction(async (savepoint) => {
      const [row] = await savepoint.execute<{ found: boolean }>(sql`
        select exists (select 1 from platform.message_deliveries where source_key = ${sourceKey}) as found`);
      return row?.found === true;
    });
  } catch (error) {
    if (pgError(error)?.code === '42703') return false;
    throw error;
  }
}

/**
 * Served organizations with web-queued messages nobody finished within a minute (the safety net of immediate
 * sending). Platform transaction. Empty before the migration.
 */
export async function listTenantsToRescueInline(tx: ClaimsTx): Promise<readonly string[]> {
  try {
    const rows = await tx.transaction((savepoint) =>
      savepoint.execute<{ tenant_id: string }>(
        sql`select tenant_id from private.inline_mail_tenants_to_rescue()`,
      ),
    );
    return rows.map((row) => row.tenant_id);
  } catch (error) {
    if (pgError(error)?.code === '42883') return [];
    throw error;
  }
}

/**
 * In the organization's job transaction: marks up to `limit` unfinished web-queued messages as taken over
 * and returns their ids, so the caller queues them for the worker's own sender. A message is taken over once
 * an hour at most.
 */
export async function takeInlineRescue(tx: ClaimsTx, limit: number): Promise<readonly string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    update platform.message_deliveries d set rescued_at = now()
    where d.id in (
      select x.id from platform.message_deliveries x
      where x.inline_claim_hash is not null and x.created_at < now() - interval '60 seconds'
        and ((x.status = 'queued' and (x.error_code is null or x.error_code <> all (private.email_waiting_codes())))
             or (x.status = 'sending' and x.updated_at < now() - make_interval(secs => ${CLAIM_LEASE_SECONDS})))
        and (x.rescued_at is null or x.rescued_at < now() - interval '1 hour')
      order by x.created_at
      limit ${limit}
      for update skip locked)
    returning d.id`);
  return rows.map((row) => row.id);
}
