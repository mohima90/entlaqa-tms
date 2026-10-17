import 'server-only';
import { defineQuery } from '@jadarat/platform-rbac';
import {
  needsFormQueryDefinition,
  needsFormsLibraryQueryDefinition,
} from '@jadarat/tms/needs-forms/server';

/** Planning → Needs forms (T-M3-10): the library and one form (tms.needs_form.read). */
export const needsFormsLibraryQuery = defineQuery(needsFormsLibraryQueryDefinition());
export const needsFormQuery = defineQuery(needsFormQueryDefinition());
