import 'server-only';
import { PlatformErrors } from '@jadarat/platform-core';
import { getMessages } from '@jadarat/platform-i18n';
import type { AppLocale } from '@jadarat/platform-i18n';
import { defineQuery } from '@jadarat/platform-rbac';
import {
  PlanningErrors,
  newPlanCycleQueryDefinition,
  planCycleQueryDefinition,
  planCyclesListQueryDefinition,
  planningSettingsQueryDefinition,
} from '@jadarat/tms';
import { getTranslations } from 'next-intl/server';
import { flattenTexts } from './flatten-texts';

/** Authorized reads of the planning pages (EP-PLN, T-M3-04; definitions and tests in modules/tms). */
export const planCyclesListQuery = defineQuery(planCyclesListQueryDefinition());
export const newPlanCycleQuery = defineQuery(newPlanCycleQueryDefinition());
export const planCycleQuery = defineQuery(planCycleQueryDefinition());
export const planningSettingsQuery = defineQuery(planningSettingsQueryDefinition());

/** Message keys the planning actions can return (platform + planning registries). */
export const PLANNING_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(PlanningErrors).map((def) => def.messageKey),
];

/** Raw error texts for the planning client forms (`{correlationId}` stays a placeholder). */
export async function planningErrorTexts(locale: AppLocale): Promise<Record<string, string>> {
  const t = await getTranslations({ locale });
  return Object.fromEntries(PLANNING_ERROR_KEYS.map((key) => [key, String(t.raw(key))]));
}

/** Every raw text of the `planning` namespace by dotted key (client forms fill placeholders). */
export function planningTexts(locale: AppLocale): Record<string, string> {
  return flattenTexts(getMessages(locale).planning);
}
