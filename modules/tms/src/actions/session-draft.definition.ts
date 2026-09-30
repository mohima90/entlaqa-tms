import type { ActionDefinition } from '@jadarat/platform-rbac';
import { tmsPermissions } from '../permissions';
import { type SessionDraft, SessionDraftInput, buildSessionDraft } from '../services/session-draft';

/**
 * Definition of the createSessionDraft server action (ADR 0003 §4): permission + zod input + resource
 * + handler, run in withUserTx. Kept out of the 'use server' module so it can be unit-tested with a
 * fake runtime; `actions/sessions.ts` binds it to the production defineAction.
 *
 * Authorized against the COURSE the session belongs to: the member's scope (e.g. org_units of the
 * course's owning department) must cover it — a scoped grant never authorizes tenant-wide work.
 * TODO(M3): persist to tms.sessions and emit TmsSessionScheduledV1 through the outbox.
 */
export function sessionDraftActionDefinition<Tx>(): ActionDefinition<
  typeof SessionDraftInput,
  SessionDraft,
  Tx
> {
  return {
    permission: tmsPermissions['tms.session.create'],
    input: SessionDraftInput,
    resource: (input) => ({ type: 'course', id: input.courseId }),
    audit: (input) => ({
      action: 'tms.session.draft_created',
      entityType: 'course',
      entityId: input.courseId,
      data: { deliveryType: input.deliveryType },
    }),
    handler: ({ input }) => Promise.resolve(buildSessionDraft(input)),
  };
}
