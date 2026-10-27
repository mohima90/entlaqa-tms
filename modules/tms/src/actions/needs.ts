'use server';

import { defineAction } from '@jadarat/platform-rbac';
import {
  addNeedActionDefinition,
  deleteNeedActionDefinition,
  extendDepartmentDeadlineActionDefinition,
  recallNeedsActionDefinition,
  returnNeedsActionDefinition,
  saveDepartmentAnswersActionDefinition,
  submitNeedsActionDefinition,
  updateNeedActionDefinition,
} from '../planning/needs-definitions';

/**
 * Department needs server actions (WP-LD-01, T-M3-05; FR-PLN-03, FR-MGR-05). Definitions and tests in
 * ../planning/needs-definitions.ts; the database enforces who may write and the state model.
 */
export const addNeedAction = defineAction(addNeedActionDefinition());
export const updateNeedAction = defineAction(updateNeedActionDefinition());
export const deleteNeedAction = defineAction(deleteNeedActionDefinition());
export const submitNeedsAction = defineAction(submitNeedsActionDefinition());
export const recallNeedsAction = defineAction(recallNeedsActionDefinition());
export const saveDepartmentAnswersAction = defineAction(saveDepartmentAnswersActionDefinition());
export const returnNeedsAction = defineAction(returnNeedsActionDefinition());
export const extendDepartmentDeadlineAction = defineAction(
  extendDepartmentDeadlineActionDefinition(),
);
