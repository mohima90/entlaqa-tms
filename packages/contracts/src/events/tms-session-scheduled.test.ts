import { describe, expect, it } from 'vitest';
import { TmsSessionScheduledV1 } from '../index';

const valid = {
  eventId: '7d0f3c7e-1a2b-4c3d-8e9f-0123456789ab',
  type: 'tms.session.scheduled',
  version: 1,
  tenantId: '22222222-2222-4222-8222-222222222222',
  occurredAt: '2026-10-01T08:00:00+03:00',
  actor: { userId: null, personId: null },
  payload: {
    sessionId: '44444444-4444-4444-8444-444444444444',
    courseId: '55555555-5555-4555-8555-555555555555',
    startsAt: '2026-10-05T09:00:00+03:00',
    endsAt: '2026-10-05T15:00:00+03:00',
    deliveryType: 'classroom',
  },
};

describe('TmsSessionScheduledV1', () => {
  it('accepts a valid event', () => {
    expect(TmsSessionScheduledV1.safeParse(valid).success).toBe(true);
  });

  it('rejects wrong type/version, bad tenant id and inverted dates', () => {
    expect(
      TmsSessionScheduledV1.safeParse({ ...valid, type: 'tms.session.cancelled' }).success,
    ).toBe(false);
    expect(TmsSessionScheduledV1.safeParse({ ...valid, version: 2 }).success).toBe(false);
    expect(TmsSessionScheduledV1.safeParse({ ...valid, tenantId: 'tenant-a' }).success).toBe(false);
    expect(
      TmsSessionScheduledV1.safeParse({
        ...valid,
        payload: { ...valid.payload, endsAt: '2026-10-05T08:00:00+03:00' },
      }).success,
    ).toBe(false);
  });
});
