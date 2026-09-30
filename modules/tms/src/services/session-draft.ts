import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import { z } from 'zod';

/** Input for a session draft (FR-SCH, M3). Titles are Arabic-first; English optional. */
export const SessionDraftInput = z.object({
  courseId: z.uuid(),
  titleAr: z.string().trim().min(3).max(200),
  titleEn: z.string().trim().min(3).max(200).optional(),
  deliveryType: z.enum(['classroom', 'virtual', 'blended', 'hybrid', 'ojt']),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  capacity: z.number().int().min(1).max(10_000),
});

export type SessionDraftInput = z.infer<typeof SessionDraftInput>;

export interface SessionDraft extends SessionDraftInput {
  readonly status: 'draft';
  readonly durationMinutes: number;
}

const MAX_DURATION_MINUTES = 60 * 24 * 90; // a scheduled run longer than 90 days is a data error

/** Server-side domain rules for a session draft. Pure: persistence arrives with the `tms` schema (M3). */
export function buildSessionDraft(input: SessionDraftInput): Result<SessionDraft, AppError> {
  const start = Date.parse(input.startsAt);
  const end = Date.parse(input.endsAt);
  if (end <= start) {
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'endsAt', code: 'BEFORE_START' }] }),
    );
  }
  const durationMinutes = Math.round((end - start) / 60_000);
  if (durationMinutes > MAX_DURATION_MINUTES) {
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: [
          {
            path: 'endsAt',
            code: 'TOO_LONG',
            params: { maximumDays: MAX_DURATION_MINUTES / 1440 },
          },
        ],
      }),
    );
  }
  return ok({ ...input, status: 'draft', durationMinutes });
}
