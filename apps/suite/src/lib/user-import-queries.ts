import 'server-only';
import {
  userImportBannersQueryDefinition,
  userImportQueryDefinition,
  userImportRowsQueryDefinition,
  userImportStartQueryDefinition,
  userImportStatusQueryDefinition,
  userImportTemplateQueryDefinition,
} from '@jadarat/platform-import';
import { defineQuery } from '@jadarat/platform-rbac';

/** Authorized reads of the user import screens (T-M2-12; definitions and tests in platform-import). */
export const userImportStartQuery = defineQuery(userImportStartQueryDefinition());
export const userImportQuery = defineQuery(userImportQueryDefinition());
/**
 * What the import page polls (integration review L1): a passive read — not the session's activity, so a
 * page left open does not keep an idle session alive.
 */
export const userImportStatusQuery = defineQuery(userImportStatusQueryDefinition());
export const userImportRowsQuery = defineQuery(userImportRowsQueryDefinition());
/** The users list's banners: a running import, people added without invitations. */
export const userImportBannersQuery = defineQuery(userImportBannersQueryDefinition());
/** The template's lists (departments and branches with codes). */
export const userImportTemplateQuery = defineQuery(userImportTemplateQueryDefinition());
