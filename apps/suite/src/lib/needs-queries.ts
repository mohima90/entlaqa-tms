import 'server-only';
import { PlatformErrors } from '@jadarat/platform-core';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { defineQuery } from '@jadarat/platform-rbac';
import {
  NeedsErrors,
  PlanningErrors,
  cycleDepartmentNeedsQueryDefinition,
  departmentNeedsQueryDefinition,
  myNeedsQueryDefinition,
} from '@jadarat/tms';
import { getTranslations } from 'next-intl/server';
import { flattenTexts } from './flatten-texts';

/** Authorized reads of the department needs pages (WP-LD-01; definitions and tests in modules/tms). */
export const myNeedsQuery = defineQuery(myNeedsQueryDefinition());
export const departmentNeedsQuery = defineQuery(departmentNeedsQueryDefinition());
export const cycleDepartmentNeedsQuery = defineQuery(cycleDepartmentNeedsQueryDefinition());

/** Message keys the needs actions can return (platform + needs + planning registries). */
export const NEEDS_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(NeedsErrors).map((def) => def.messageKey),
  ...Object.values(PlanningErrors).map((def) => def.messageKey),
];

/** Raw error texts for the needs client components (`{correlationId}` stays a placeholder). */
export async function needsErrorTexts(locale: AppLocale): Promise<Record<string, string>> {
  const t = await getTranslations({ locale });
  return Object.fromEntries(NEEDS_ERROR_KEYS.map((key) => [key, String(t.raw(key))]));
}

/** Every raw text of the `needsEntry` namespace by dotted key, plus the shared words the panel uses. */
export function needsTexts(locale: AppLocale): Record<string, string> {
  const messages = getMessages(locale);
  return {
    ...flattenTexts(messages.needsEntry),
    required: messages.common.required,
    optional: messages.common.optional,
    typeToSearch: messages.common.typeToSearch,
    noMatches: messages.common.noMatches,
    keepEditing: messages.common.keepEditing,
    discardChanges: messages.common.discardChanges,
    shownAs: messages.planning.setup.basics.shownAs,
  };
}
