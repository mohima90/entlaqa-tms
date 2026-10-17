import 'server-only';
import { defineQuery, emailIntegrationQueryDefinition } from '@jadarat/platform-rbac';

/**
 * Settings → Email integration (WP-ADM-01): the organization's provider (never its secrets), its waiting
 * messages and latest delivery errors — members with platform.tenant.read; the Organization Admin edits.
 */
export const emailIntegrationQuery = defineQuery(emailIntegrationQueryDefinition());
