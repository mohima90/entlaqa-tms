import 'server-only';
import { brandingQueryDefinition, defineQuery } from '@jadarat/platform-rbac';

/** Organization → Branding (WP-ADM-02): readers of the organization's settings; the admin edits. */
export const brandingQuery = defineQuery(brandingQueryDefinition());
