import { z } from 'zod';
import { eventEnvelope } from './envelope';

/** Example contract: TMS announces a scheduled session; other modules (e.g., Core HR calendars) may consume. */
export const TmsSessionScheduledV1 = eventEnvelope(
  'tms.session.scheduled',
  1,
  z.object({
    sessionId: z.uuid(),
    courseId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    deliveryType: z.enum(['classroom', 'virtual', 'blended', 'hybrid', 'ojt']),
  }),
).refine((event) => Date.parse(event.payload.endsAt) > Date.parse(event.payload.startsAt), {
  message: 'endsAt must be after startsAt',
  path: ['payload', 'endsAt'],
});

export type TmsSessionScheduledV1 = z.infer<typeof TmsSessionScheduledV1>;
