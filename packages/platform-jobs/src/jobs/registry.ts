import type { SystemTx } from '@jadarat/platform-db/jobs';

/** An event as a subscriber receives it (ADR 0004 §2: thin, identifiers only). */
export interface DeliveredEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly version: number;
  readonly subject: string | null;
  readonly data: Readonly<Record<string, unknown>>;
  readonly actorType: 'user' | 'system' | 'platform';
  /** The user, for `actorType: 'user'`. */
  readonly actorId: string | null;
  /** The job that wrote the event, for `actorType: 'system'`. */
  readonly actorJob: string | null;
  readonly correlationId: string | null;
  readonly createdAt: Date;
}

/**
 * A subscriber reacts to events of the given types (ADR 0004 §4–§5). `handle` runs inside the job's
 * tenant transaction (withSystemTx: system claims, RLS applies) together with the inbox row, so its
 * database work happens exactly once. It must not call external services (e-mail, LMS): it writes a
 * delivery record and leaves the call to a separate job keyed by that record.
 */
export interface Subscriber {
  /** Stable name, also the inbox key (`notifications.email`, `compliance-projector@v2`). */
  readonly name: string;
  readonly types: readonly string[];
  /** Delivery attempts before the job is left failed (default 10). */
  readonly maxAttempts?: number;
  handle(context: { readonly tx: SystemTx; readonly event: DeliveredEvent }): Promise<void>;
}

export interface SubscriberRegistry {
  forType(type: string): readonly Subscriber[];
  get(name: string): Subscriber | undefined;
  readonly names: readonly string[];
}

const NAME = /^[a-z][a-z0-9_.@-]{0,99}$/;
const TYPE = /^com\.entlaqa\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Registered in code: the single source of truth for who reacts to what. */
export function createSubscriberRegistry(subscribers: readonly Subscriber[]): SubscriberRegistry {
  const byName = new Map<string, Subscriber>();
  for (const subscriber of subscribers) {
    if (!NAME.test(subscriber.name))
      throw new Error(`subscriber name "${subscriber.name}" is invalid`);
    if (byName.has(subscriber.name))
      throw new Error(`subscriber "${subscriber.name}" is registered twice`);
    if (subscriber.types.length === 0)
      throw new Error(`subscriber "${subscriber.name}" has no event types`);
    for (const type of subscriber.types) {
      if (!TYPE.test(type))
        throw new Error(`subscriber "${subscriber.name}": invalid event type "${type}"`);
    }
    byName.set(subscriber.name, subscriber);
  }
  return {
    forType: (type) => subscribers.filter((s) => s.types.includes(type)),
    get: (name) => byName.get(name),
    names: [...byName.keys()],
  };
}
