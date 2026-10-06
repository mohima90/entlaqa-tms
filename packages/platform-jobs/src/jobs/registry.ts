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

interface SubscriberBase {
  /** Stable name, also the inbox key (`notifications.email`, `compliance-projector@v2`). */
  readonly name: string;
  readonly types: readonly string[];
  /** Delivery attempts before the job is left failed (default 10). */
  readonly maxAttempts?: number;
}

/**
 * The default kind (ADR 0004 §4–§5): `handle` runs inside the job's tenant transaction (withSystemTx:
 * system claims, RLS applies) together with the inbox row, so its database work happens exactly once.
 * It must not call external services (e-mail, LMS): it writes a delivery record whose own event starts
 * an `effect` subscriber.
 */
export interface TransactionalSubscriber extends SubscriberBase {
  readonly kind?: 'transactional';
  handle(context: { readonly tx: SystemTx; readonly event: DeliveredEvent }): Promise<void>;
}

/** Runs `fn` in a system transaction of the event's tenant (a new transaction per call). */
export type InTenant = <T>(fn: (tx: SystemTx) => Promise<T>) => Promise<T>;

/**
 * Calls an external service for one event (ADR 0004 §5: e-mail send, LMS push), outside any
 * transaction and without an inbox row, so delivery is at-least-once. It must be idempotent on its
 * own: claim a delivery record in the tenant (`inTenant`), call the service with that record's id as
 * idempotency key, record the outcome. A retry finds the record finished and does nothing.
 */
export interface EffectSubscriber extends SubscriberBase {
  readonly kind: 'effect';
  perform(context: {
    readonly event: DeliveredEvent;
    readonly inTenant: InTenant;
    /** This attempt's number (1-based) and the last one: on the last, record a final failure. */
    readonly attempt: number;
    readonly maxAttempts: number;
  }): Promise<void>;
  /**
   * Called instead of `perform` when the organization is suspended or closed (no deliveries, never
   * replayed: ADR 0005 §4): release what the record holds, e.g. a waiting message's content. The
   * tenant's RLS no longer lets `inTenant` reach its rows, so this goes through a narrow database
   * function made for it.
   */
  discard?(context: { readonly event: DeliveredEvent; readonly inTenant: InTenant }): Promise<void>;
}

export type Subscriber = TransactionalSubscriber | EffectSubscriber;

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
    if (subscriber.kind !== undefined && !['transactional', 'effect'].includes(subscriber.kind))
      throw new Error(`subscriber "${subscriber.name}": unknown kind`);
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
