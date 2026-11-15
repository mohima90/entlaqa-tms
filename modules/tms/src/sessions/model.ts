import { z } from 'zod';
import { CreateCourseInput } from '../courses/model';
import { Id, Version } from '../planning/model';
import { SESSION_SEATS_MAX, isMonth } from './rules';

export * from './rules';

/**
 * Input schemas of the draft-session queries and server actions (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01, FR-SCH-01
 * core): untrusted input, validated before authorization and the handler run. The same limits as the database
 * (migration 20261117100200).
 */

/** A month as `YYYY-MM`. */
export const MonthInput = z.string().refine(isMonth, { message: 'month' });

/** At most this many sessions in one «Create draft sessions» (a line of 10,000 people at one per session is a typo). */
export const DRAFTS_PER_CALL_MAX = 100;
/** At most this many planned participants in one call (a session's seats). */
const PEOPLE_MAX = SESSION_SEATS_MAX;

const Seats = z.int().min(1).max(SESSION_SEATS_MAX);
const People = z
  .array(Id)
  .max(PEOPLE_MAX)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
    message: 'duplicate',
  });

/** The approved plan of a cycle, with its lines' courses and drafts (the Plan tab's two new columns). */
export const PlanDeliveryInput = z.strictObject({ cycleId: Id });
export type PlanDeliveryInput = z.output<typeof PlanDeliveryInput>;

/** A plan line (the «Create draft sessions» proposal). */
export const PlanLineRef = z.strictObject({ lineId: Id });
export type PlanLineRef = z.output<typeof PlanLineRef>;

/** «Create course» from an approved line: the course popup's values, pre-filled from the line and edited by L&D. */
export const CreateCourseFromLineInput = z.strictObject({
  lineId: Id,
  /** The line's version as the page read it (optimistic concurrency). */
  lineVersion: Version,
  course: CreateCourseInput,
});
export type CreateCourseFromLineInput = z.output<typeof CreateCourseFromLineInput>;

/** «Link course»: a course of the library for an approved line. */
export const LinkLineCourseInput = z.strictObject({
  lineId: Id,
  lineVersion: Version,
  courseId: Id,
});
export type LinkLineCourseInput = z.output<typeof LinkLineCourseInput>;

/** One session of «Create draft sessions», as L&D confirmed it. */
export const DraftSessionValues = z.strictObject({
  month: MonthInput,
  /** Null: no branch («Online», or not decided). */
  branchId: Id.nullable(),
  seats: Seats,
  /** The planned participants: people named for the line's needs, each in one session of the line. */
  personIds: People,
});
export type DraftSessionValues = z.output<typeof DraftSessionValues>;

export const CreateDraftSessionsInput = z.strictObject({
  lineId: Id,
  sessions: z.array(DraftSessionValues).min(1).max(DRAFTS_PER_CALL_MAX),
});
export type CreateDraftSessionsInput = z.output<typeof CreateDraftSessionsInput>;

/** A draft's changes (undefined: unchanged). `personIds`: the full list of its planned participants. */
export const UpdateDraftSessionInput = z.strictObject({
  sessionId: Id,
  version: Version,
  month: MonthInput.optional(),
  branchId: Id.nullable().optional(),
  seats: Seats.optional(),
  personIds: People.optional(),
});
export type UpdateDraftSessionInput = z.output<typeof UpdateDraftSessionInput>;

export const DraftSessionRef = z.strictObject({ sessionId: Id });
export type DraftSessionRef = z.output<typeof DraftSessionRef>;

export const DeleteDraftSessionInput = z.strictObject({ sessionId: Id, version: Version });
export type DeleteDraftSessionInput = z.output<typeof DeleteDraftSessionInput>;

/** «Move to another session» (review L6): one planned participant of a draft to another draft of the same line. */
export const MoveDraftParticipantInput = z.strictObject({
  sessionId: Id,
  version: Version,
  personId: Id,
  toSessionId: Id,
});
export type MoveDraftParticipantInput = z.output<typeof MoveDraftParticipantInput>;

/** The training calendar: a year, filtered by quarter, branch (`none`: no branch) and course. */
export const TrainingCalendarInput = z.strictObject({
  /** Absent: the year of the latest approved plan with drafts the viewer reads (else this year). */
  year: z.int().min(2000).max(2100).optional(),
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  branchId: z.union([z.literal('none'), Id]).optional(),
  courseId: Id.optional(),
});
export type TrainingCalendarInput = z.output<typeof TrainingCalendarInput>;
