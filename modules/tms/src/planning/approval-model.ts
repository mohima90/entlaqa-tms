import { hasVisibleText } from '@jadarat/platform-i18n/text';
import { z } from 'zod';
import { APPROVAL_STEPS, PLAN_DECISIONS, SEND_BACK_COMMENT_MAX } from './approval-rules';
import { Id, Version } from './model';

export * from './approval-rules';

/**
 * Input schemas of the plan approval's queries and server actions (WP-LD-03, T-M3-07; FR-PLN-08): untrusted input,
 * validated before authorization and the handler run. The same limits as the database (migration 20261116100200).
 */

/** Bidirectional embedding/override/isolate marks: never in texts the L&D Manager reads. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/u;

/** The plan as the user saw it (its row version): submit, revise. */
export const PlanVersionRef = z.strictObject({ planId: Id, version: Version });
export type PlanVersionRef = z.output<typeof PlanVersionRef>;

/**
 * A decision on the step the approver saw (steps 9, 10, 12). Sending back needs one comment for the whole plan
 * (Q5 = A); approving takes none.
 */
export const DecidePlanInput = z
  .strictObject({
    planId: Id,
    version: Version,
    step: z.enum(APPROVAL_STEPS),
    decision: z.enum(PLAN_DECISIONS),
    comment: z
      .string()
      .normalize('NFC')
      .trim()
      .max(SEND_BACK_COMMENT_MAX)
      // Line breaks and tabs are welcome in a comment; other control characters are not.
      .refine((v) => !/[^\P{Cc}\n\r\t]/u.test(v) && !BIDI_CONTROLS.test(v), {
        message: 'invalid',
      })
      .nullable()
      .optional()
      .transform((v) =>
        v === undefined || v === null || v === '' || !hasVisibleText(v) ? null : v,
      ),
  })
  .superRefine((value, context) => {
    if (value.decision === 'send_back' && value.comment === null) {
      context.addIssue({ code: 'custom', path: ['comment'], message: 'required' });
    }
  });
export type DecidePlanInput = z.output<typeof DecidePlanInput>;

/** One approved version of a cycle's plan (read only). */
export const PlanVersionViewInput = z.strictObject({
  cycleId: Id,
  planVersion: z.int().min(1).max(100_000),
});
export type PlanVersionViewInput = z.output<typeof PlanVersionViewInput>;

/** The Approvals page and Home: no input. */
export const ApprovalsInput = z.strictObject({});
