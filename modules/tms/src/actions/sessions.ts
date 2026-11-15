'use server';

import { defineAction } from '@jadarat/platform-rbac';
import {
  createCourseFromLineActionDefinition,
  createDraftSessionsActionDefinition,
  deleteDraftSessionActionDefinition,
  linkLineCourseActionDefinition,
  moveDraftParticipantActionDefinition,
  updateDraftSessionActionDefinition,
} from '../sessions/definitions';

/**
 * From the approved plan to courses and draft sessions — server actions (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01,
 * FR-SCH-01 core). Definitions and tests in ../sessions/definitions.ts; the database repeats every rule (migration
 * 20261117100200). The reads (planDeliveryQueryDefinition, draftProposalQueryDefinition,
 * draftSessionQueryDefinition, trainingCalendarQueryDefinition) are queries bound with defineQuery in the app.
 */
export const createCourseFromLineAction = defineAction(createCourseFromLineActionDefinition());
export const linkLineCourseAction = defineAction(linkLineCourseActionDefinition());
export const createDraftSessionsAction = defineAction(createDraftSessionsActionDefinition());
export const updateDraftSessionAction = defineAction(updateDraftSessionActionDefinition());
export const deleteDraftSessionAction = defineAction(deleteDraftSessionActionDefinition());
export const moveDraftParticipantAction = defineAction(moveDraftParticipantActionDefinition());
