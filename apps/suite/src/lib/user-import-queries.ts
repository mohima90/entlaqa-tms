import 'server-only';
import {
  userImportBannersQueryDefinition,
  userImportQueryDefinition,
  userImportRowsQueryDefinition,
  userImportStartQueryDefinition,
  userImportTemplateQueryDefinition,
} from '@jadarat/platform-import';
import { defineQuery } from '@jadarat/platform-rbac';

/** Authorized reads of the user import screens (T-M2-12; definitions and tests in platform-import). */
export const userImportStartQuery = defineQuery(userImportStartQueryDefinition());
export const userImportQuery = defineQuery(userImportQueryDefinition());
export const userImportRowsQuery = defineQuery(userImportRowsQueryDefinition());
/** The users list's banners: a running import, people added without invitations. */
export const userImportBannersQuery = defineQuery(userImportBannersQueryDefinition());
/** The template's lists (departments and branches with codes). */
export const userImportTemplateQuery = defineQuery(userImportTemplateQueryDefinition());
