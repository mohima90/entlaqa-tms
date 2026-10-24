import 'server-only';
import {
  type OrganizationPlan,
  PlanError,
  getOrganizationPlan,
  withUserTx,
} from '@jadarat/platform-db';
import { defineQuery, organizationPlanQueryDefinition } from '@jadarat/platform-rbac';
import { requestSessionState } from './request-session';

/** Subscription (WP-ADM-06): the organization's plan, status, limits and usage — the Organization Admin. */
export const organizationPlanQuery = defineQuery(organizationPlanQueryDefinition());

/**
 * The plan of a SUSPENDED organization for its Organization Admin (the paused page, WP-ADM-06): the session
 * acts there in the state 'paused', which no action or query of the suite serves, so this reads the database
 * function directly — it checks the paused admin itself (private.organization_plan). Null for anyone else.
 */
export async function pausedOrganizationPlan(): Promise<OrganizationPlan | null> {
  const session = await requestSessionState();
  if (session.kind !== 'paused') return null;
  try {
    return await withUserTx(session.claims, (tx) => getOrganizationPlan(tx));
  } catch (error) {
    if (error instanceof PlanError) return null;
    throw error;
  }
}
