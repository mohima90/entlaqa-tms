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
 * Transactions that queued work for the background worker (in memory, by object identity; never shared between
 * requests): every emitted event needs a worker pass to be delivered, and a few writes queue work without an
 * event (noteWorkQueued) — so defineAction asks for a pass after such a transaction committed (ADR 0005 §1
 * amendment, 20 Oct 2026 — platform-jobs ./kick).
 *
 * Limits (security review L2): only what goes through `emitEvent` or `noteWorkQueued` on THIS transaction
 * object is seen. Not seen: rows a SQL function or trigger queues on its own (an outbox insert or a
 * graphile-worker job added inside the database, e.g. private.* functions that write a settings row the worker
 * polls), work queued in another transaction (beforeTransaction, afterCommit, a nested withSystemTx), and
 * work queued by jobs themselves. Such actions declare `queuesWork` (platform-rbac defineAction) or call
 * `noteWorkQueued`; anything missed still runs on the next scheduled pass (GitHub's 5-minute schedule, the
 * per-minute cron) — later, never lost.
 */
const transactionsWithQueuedWork = new WeakSet<object>();

/**
 * Did `tx` queue worker work (emitEvent, noteWorkQueued)? True even if it later rolled back — callers check
 * after the commit.
 */
export function queuedWorkIn(tx: ClaimsTx): boolean {
  return transactionsWithQueuedWork.has(tx);
}

/**
 * Marks `tx` as having queued work for the worker that no event announces (e.g. a branding image left for the
 * worker's publishing fallback): defineAction then asks for a worker pass once it has committed.
 */
export function noteWorkQueued(tx: ClaimsTx): void {
  transactionsWithQueuedWork.add(tx);
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
  transactionsWithQueuedWork.add(tx);
  return id;
}
