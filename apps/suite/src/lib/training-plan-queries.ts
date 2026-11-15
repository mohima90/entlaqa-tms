import 'server-only';
import { PlatformErrors } from '@jadarat/platform-core';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { defineQuery } from '@jadarat/platform-rbac';
import {
  PlanApprovalErrors,
  PlanningErrors,
  TrainingPlanErrors,
  approvalsQueryDefinition,
  departmentPlanResultQueryDefinition,
  myPlanResultsQueryDefinition,
  planApprovalQueryDefinition,
  planQueryDefinition,
  planVersionQueryDefinition,
} from '@jadarat/tms';
import { getTranslations } from 'next-intl/server';
import { flattenTexts } from './flatten-texts';

/**
 * The training plan of a cycle — the Plan tab and the budget by department (WP-LD-02, T-M3-06; FR-PLN-05,
 * FR-PLN-06). The definition and its tests live in modules/tms (consolidation-definitions.ts); the actions are
 * `@jadarat/tms/actions/consolidation`.
 */
const planThroughRead = defineQuery(planQueryDefinition('read'));
const planThroughManage = defineQuery(planQueryDefinition('manage'));

/**
 * Reading the plan needs tms.training_plan.read OR .manage (a custom role may hold manage alone): asked through
 * read first and, refused for a missing permission, through manage.
 */
export async function trainingPlanQuery(
  input: Parameters<typeof planThroughRead>[0],
): ReturnType<typeof planThroughRead> {
  const read = await planThroughRead(input);
  if (read.ok || read.error.code !== 'FORBIDDEN') return read;
  return planThroughManage(input);
}

/**
 * Where a cycle's plan stands in its approval (WP-LD-03, T-M3-07; FR-PLN-08): the Plan tab's banner and actions,
 * the submit popup's steps, the review's side column. Through read, then manage, as the Plan tab.
 */
const approvalThroughRead = defineQuery(planApprovalQueryDefinition('read'));
const approvalThroughManage = defineQuery(planApprovalQueryDefinition('manage'));

export async function planApprovalQuery(
  input: Parameters<typeof approvalThroughRead>[0],
): ReturnType<typeof approvalThroughRead> {
  const read = await approvalThroughRead(input);
  if (read.ok || read.error.code !== 'FORBIDDEN') return read;
  return approvalThroughManage(input);
}

/** The Approvals page and the approvers' Home card (with the plans' figures). */
export const approvalsQuery = defineQuery(approvalsQueryDefinition());
/** The menu's count of plans waiting for the viewer (no figures). */
export const approvalsCountQuery = defineQuery(approvalsQueryDefinition({ figures: false }));
/** An approved version, read only («Versions»). */
export const planVersionQuery = defineQuery(planVersionQueryDefinition());
/** A department's result once the plan is approved (its effective head). */
export const departmentPlanResultQuery = defineQuery(departmentPlanResultQueryDefinition());
/** The Department Head's approved results (Home). */
export const myPlanResultsQuery = defineQuery(myPlanResultsQueryDefinition());

/** Message keys the training plan's actions can return (platform + planning + training plan registries). */
export const TRAINING_PLAN_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(PlanningErrors).map((def) => def.messageKey),
  ...Object.values(TrainingPlanErrors).map((def) => def.messageKey),
  ...Object.values(PlanApprovalErrors).map((def) => def.messageKey),
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

/** The Plan tab's texts and the approval's (`approval.*`, namespace `planApproval`), for its client components. */
export function planApprovalTexts(locale: AppLocale): Record<string, string> {
  const messages = getMessages(locale);
  return { ...trainingPlanTexts(locale), ...flattenTexts({ approval: messages.planApproval }) };
}
