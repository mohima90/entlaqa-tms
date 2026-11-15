'use server';

import { defineAction } from '@jadarat/platform-rbac';
import {
  decidePlanActionDefinition,
  revisePlanActionDefinition,
  submitPlanActionDefinition,
} from '../planning/approval-definitions';

/**
 * Training plan approval server actions (WP-LD-03, T-M3-07; FR-PLN-08, FR-WFL-01/02 R1 part). Definitions and
 * tests in ../planning/approval-definitions.ts; the database decides every step from the verified claims
 * (migration 20261116100200). The reads are queries bound with defineQuery in the app.
 */
export const submitPlanAction = defineAction(submitPlanActionDefinition());
export const decidePlanAction = defineAction(decidePlanActionDefinition());
export const revisePlanAction = defineAction(revisePlanActionDefinition());
