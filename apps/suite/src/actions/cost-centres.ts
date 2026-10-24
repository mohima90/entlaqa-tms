'use server';
/**
 * Structure → Cost centres (WP-HR-01; FR-ADM-05, FR-FIN-03): the HR Manager's list of cost centres. Definitions
 * and tests in @jadarat/platform-rbac (iam/cost-centres.ts); the database repeats every rule
 * (platform.cost_centres).
 */
import {
  createCostCentreActionDefinition,
  defineAction,
  deleteCostCentreActionDefinition,
  updateCostCentreActionDefinition,
} from '@jadarat/platform-rbac';

export const createCostCentreAction = defineAction(createCostCentreActionDefinition());

/** Code, names, active / inactive. */
export const updateCostCentreAction = defineAction(updateCostCentreActionDefinition());

/** Delete one nobody has and no unit gives. */
export const deleteCostCentreAction = defineAction(deleteCostCentreActionDefinition());
