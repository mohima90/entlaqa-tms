'use server';

import { defineAction } from '@jadarat/platform-rbac';
import {
  createPlanCycleActionDefinition,
  deletePlanCycleActionDefinition,
  extendPlanCycleDeadlineActionDefinition,
  launchPlanCycleActionDefinition,
  savePlanCycleBudgetsActionDefinition,
  savePlanCycleRemindersActionDefinition,
  savePlanCycleScopeActionDefinition,
  savePlanCycleStepsActionDefinition,
  savePlanningSettingsActionDefinition,
  updatePlanCycleBasicsActionDefinition,
} from '../planning/definitions';

/**
 * Planning cycle server actions (EP-PLN, T-M3-04; FR-PLN-02, FR-WFL-01/02 R1 part). Definitions and tests
 * in ../planning/definitions.ts; the database enforces who may write and the state model.
 */
export const createPlanCycleAction = defineAction(createPlanCycleActionDefinition());
export const updatePlanCycleBasicsAction = defineAction(updatePlanCycleBasicsActionDefinition());
export const savePlanCycleScopeAction = defineAction(savePlanCycleScopeActionDefinition());
export const savePlanCycleBudgetsAction = defineAction(savePlanCycleBudgetsActionDefinition());
export const savePlanCycleStepsAction = defineAction(savePlanCycleStepsActionDefinition());
export const savePlanCycleRemindersAction = defineAction(savePlanCycleRemindersActionDefinition());
export const launchPlanCycleAction = defineAction(launchPlanCycleActionDefinition());
export const extendPlanCycleDeadlineAction = defineAction(
  extendPlanCycleDeadlineActionDefinition(),
);
export const deletePlanCycleAction = defineAction(deletePlanCycleActionDefinition());
export const savePlanningSettingsAction = defineAction(savePlanningSettingsActionDefinition());
