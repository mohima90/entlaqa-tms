'use server';
/**
 * Settings → Email integration (WP-ADM-01; FR-NTF-11). Definitions and tests in @jadarat/platform-rbac
 * (iam/email-integration.ts); the database enforces the rules. Provider secrets are sealed on the server for
 * the worker and never come back to any page.
 */
import {
  defineAction,
  requestTenantEmailTestActionDefinition,
  saveTenantEmailSettingsActionDefinition,
  setTenantEmailEnabledActionDefinition,
} from '@jadarat/platform-rbac';

/** Organization Admin (platform.tenant.manage, high risk: getUser). */
export const saveTenantEmailSettingsAction = defineAction(
  saveTenantEmailSettingsActionDefinition(),
);

/** «إرسال رسالة تجريبية» / Send test e-mail through the organization's provider. */
export const requestTenantEmailTestAction = defineAction(requestTenantEmailTestActionDefinition());

/** Switch the organization's provider on (once verified) or back to the platform sender. */
export const setTenantEmailEnabledAction = defineAction(setTenantEmailEnabledActionDefinition());
