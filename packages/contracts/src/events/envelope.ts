import { z } from 'zod';

/**
 * Domain event envelope (transactional outbox; details in ADR 0004, pending).
 * `tenantId` is taken from the verified tenant context of the producing transaction — never from
 * client input. Payloads carry IDs, not personal data.
 */
export function eventEnvelope<T extends string, P extends z.ZodType>(
  type: T,
  version: number,
  payload: P,
) {
  return z.object({
    eventId: z.uuid(),
    type: z.literal(type),
    version: z.literal(version),
    tenantId: z.uuid(),
    occurredAt: z.iso.datetime({ offset: true }),
    actor: z.object({
      userId: z.uuid().nullable(),
      personId: z.uuid().nullable(),
    }),
    /** Idempotency: consumers de-duplicate on eventId. */
    payload,
  });
}
