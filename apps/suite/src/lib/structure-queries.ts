import 'server-only';
import {
  branchesPageQueryDefinition,
  defineQuery,
  structurePageQueryDefinition,
} from '@jadarat/platform-rbac';

/** Organization → Structure (T-M3-02): the levels, the tree and the form choices. */
export const structurePageQuery = defineQuery(structurePageQueryDefinition());

/** Organization → Branches (FR-ADM-04 core fields). */
export const branchesPageQuery = defineQuery(branchesPageQueryDefinition());
