import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ClaimsTx } from './claims-tx';

/**
 * Domain events (ADR 0004 §1): emitted in the SAME transaction as the business change, so an event
 * exists exactly when the change committed. The database stamps tenant and actor from the verified
 * claims; the job runner (app_queue) fans the event out to subscribers after commit.
 * Thin events: identifiers and changed facts, never names, e-mail addresses or phone numbers.
 */
export const EVENT_TYPE_PATTERN =
  /^com\.entlaqa\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface EmittedEvent {
  /** `com.entlaqa.<module>.<entity>.<action>`. */
  readonly type: string;
  readonly version?: number;
  /** The aggregate the event is about (e.g. the invitation id). */
  readonly subject?: string | null;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/**
 * Transactions that emitted an event (in memory, by object identity; never shared between requests): every
 * event needs a worker pass to be delivered, so defineAction asks for one after such a transaction committed
 * (ADR 0005 §1 amendment, 20 Oct 2026 — platform-jobs ./kick).
 */
const transactionsWithEvents = new WeakSet<object>();

/** Did `tx` emit an event (emitEvent)? True even if it later rolled back — callers check after commit. */
export function emittedEventsIn(tx: ClaimsTx): boolean {
  return transactionsWithEvents.has(tx);
}

/**
 * Inserts the event into platform.event_outbox and returns its id (the consumers' idempotency key).
 * The id is chosen here: request and job roles may append to the outbox but never read it, so the
 * insert cannot use RETURNING.
 */
export async function emitEvent(tx: ClaimsTx, event: EmittedEvent): Promise<string> {
  if (!EVENT_TYPE_PATTERN.test(event.type) || event.type.length > 200) {
    throw new Error(`emitEvent: invalid event type "${event.type}"`);
  }
  const id = randomUUID();
  await tx.execute(sql`
    insert into platform.event_outbox (id, type, schema_version, subject, data, correlation_id)
    values (${id}::uuid, ${event.type}, ${event.version ?? 1}, ${event.subject ?? null}::uuid,
            ${JSON.stringify(event.data ?? {})}::jsonb, ${event.correlationId ?? null})`);
  transactionsWithEvents.add(tx);
  return id;
}
