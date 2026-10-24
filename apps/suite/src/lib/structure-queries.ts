import 'server-only';
import { unitImportTemplateQueryDefinition } from '@jadarat/platform-import';
import {
  branchesPageQueryDefinition,
  costCentresPageQueryDefinition,
  defineQuery,
  structurePageQueryDefinition,
} from '@jadarat/platform-rbac';

/** Organization → Structure (T-M3-02): the levels, the tree and the form choices. */
export const structurePageQuery = defineQuery(structurePageQueryDefinition());

/** Organization → Branches (FR-ADM-04 core fields). */
export const branchesPageQuery = defineQuery(branchesPageQueryDefinition());

/** Structure → Cost centres (WP-HR-01). */
export const costCentresPageQuery = defineQuery(costCentresPageQueryDefinition());

/** Structure → Import units: the template is for the HR Manager (WP-HR-01). */
export const unitImportTemplateQuery = defineQuery(unitImportTemplateQueryDefinition());
