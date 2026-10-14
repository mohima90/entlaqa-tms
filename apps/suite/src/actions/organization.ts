'use server';
/**
 * Organization profile and regional settings (FR-ADM-02, FR-SCH-07; T-M2-22). Definition and tests in
 * @jadarat/platform-rbac (iam/organization-profile.ts); the database enforces the rules.
 */
import { defineAction, updateOrganizationProfileActionDefinition } from '@jadarat/platform-rbac';

/** Organization Admin at AAL2 only (platform.tenant.manage: high risk, getUser + a recent code). */
export const updateOrganizationProfileAction = defineAction(
  updateOrganizationProfileActionDefinition(),
);
