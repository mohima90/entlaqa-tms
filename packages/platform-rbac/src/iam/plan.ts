import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type OrganizationPlan,
  PlanError,
  type UserTx,
  getOrganizationPlan,
} from '@jadarat/platform-db';
import { z } from 'zod';
import type { QueryDefinition } from '../define-query';
import { platformPermissions as p } from '../platform-permissions';

/**
 * Subscription «الاشتراك» (WP-ADM-06; FR-ADM-13, FR-SUB-01; business flow EP-PLAN, agreed 24 Oct 2026): the
 * organization's plan, status (days left of a trial), limits with what is used, and the features the plan
 * includes — read-only for the Organization Admin (`platform.tenant.manage`; no feature switches, PO 24 Oct
 * 2026). The plan is set by ENTLAQA's Super Admin. The database decides again (private.organization_plan).
 */
export function organizationPlanQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  OrganizationPlan,
  UserTx
> {
  return {
    permission: p['platform.tenant.manage'],
    input: z.strictObject({}),
    handler: async ({ ctx }) => {
      try {
        return ok(await getOrganizationPlan(ctx.tx));
      } catch (error) {
        if (error instanceof PlanError && error.code === 'NOT_ALLOWED') {
          return err<AppError>(appError('FORBIDDEN'));
        }
        throw error;
      }
    },
  };
}
