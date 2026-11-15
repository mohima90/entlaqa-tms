import 'server-only';
import { PlatformErrors } from '@jadarat/platform-core';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { defineQuery } from '@jadarat/platform-rbac';
import { PlanningErrors, TrainingPlanErrors, planQueryDefinition } from '@jadarat/tms';
import { getTranslations } from 'next-intl/server';
import { flattenTexts } from './flatten-texts';

/**
 * The training plan of a cycle — the Plan tab and the budget by department (WP-LD-02, T-M3-06; FR-PLN-05,
 * FR-PLN-06). The definition and its tests live in modules/tms (consolidation-definitions.ts); the actions are
 * `@jadarat/tms/actions/consolidation`.
 */
export const trainingPlanQuery = defineQuery(planQueryDefinition());

/** Message keys the training plan's actions can return (platform + planning + training plan registries). */
export const TRAINING_PLAN_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(PlanningErrors).map((def) => def.messageKey),
  ...Object.values(TrainingPlanErrors).map((def) => def.messageKey),
];

/** Raw error texts for the Plan tab's client components (`{correlationId}` stays a placeholder). */
export async function trainingPlanErrorTexts(locale: AppLocale): Promise<Record<string, string>> {
  const t = await getTranslations({ locale });
  return Object.fromEntries(TRAINING_PLAN_ERROR_KEYS.map((key) => [key, String(t.raw(key))]));
}

/** Every raw text of the `trainingPlan` namespace by dotted key, plus the shared words its popups use. */
export function trainingPlanTexts(locale: AppLocale): Record<string, string> {
  const messages = getMessages(locale);
  return {
    ...flattenTexts(messages.trainingPlan),
    ...flattenTexts({ deliveryTypes: messages.courses.deliveryTypes }),
    required: messages.common.required,
    optional: messages.common.optional,
  };
}
