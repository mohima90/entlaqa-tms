'use server';

import { defineAction } from '@jadarat/platform-rbac';
import {
  bringBackPlanLineActionDefinition,
  leaveOutPlanLineActionDefinition,
  mergePlanLinesActionDefinition,
  moveNeedOutActionDefinition,
  openConsolidationActionDefinition,
  setBudgetReasonActionDefinition,
  setPlanLinesQuarterActionDefinition,
  syncPlanNeedsActionDefinition,
  updatePlanLineActionDefinition,
} from '../planning/consolidation-definitions';

/**
 * Training plan server actions — consolidation and the budget check (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06,
 * FR-IAM-08). Definitions and tests in ../planning/consolidation-definitions.ts; the database enforces who may
 * write and the plan's state (migrations 20261115100200–100400). The Plan tab's read is a query
 * (`planQueryDefinition`, bound with defineQuery in the app).
 */
export const openConsolidationAction = defineAction(openConsolidationActionDefinition());
export const syncPlanNeedsAction = defineAction(syncPlanNeedsActionDefinition());
export const updatePlanLineAction = defineAction(updatePlanLineActionDefinition());
export const mergePlanLinesAction = defineAction(mergePlanLinesActionDefinition());
export const moveNeedOutAction = defineAction(moveNeedOutActionDefinition());
export const setPlanLinesQuarterAction = defineAction(setPlanLinesQuarterActionDefinition());
export const leaveOutPlanLineAction = defineAction(leaveOutPlanLineActionDefinition());
export const bringBackPlanLineAction = defineAction(bringBackPlanLineActionDefinition());
export const setBudgetReasonAction = defineAction(setBudgetReasonActionDefinition());
