import 'server-only';
import { PlatformErrors } from '@jadarat/platform-core';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { defineQuery } from '@jadarat/platform-rbac';
import {
  DraftSessionErrors,
  draftProposalQueryDefinition,
  draftSessionQueryDefinition,
  planDeliveryQueryDefinition,
  trainingCalendarQueryDefinition,
} from '@jadarat/tms';
import { getTranslations } from 'next-intl/server';
import { flattenTexts } from './flatten-texts';

/**
 * From the approved plan to courses and draft sessions (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01, FR-SCH-01): the
 * reads of the «Courses and sessions» page of a cycle and of the training calendar. Definitions and tests in
 * modules/tms (sessions/definitions.ts); the actions are `@jadarat/tms/actions/sessions`. Every one needs
 * tms.session.manage (in its scope): nobody else reads a draft.
 */

/** The approved plan's lines with their course and drafts, the card's figures and the filter counts. */
export const planDeliveryQuery = defineQuery(planDeliveryQueryDefinition());
/** «Create draft sessions»: the line, its people and the proposal. */
export const draftProposalQuery = defineQuery(draftProposalQueryDefinition());
/** A draft opened from the calendar. */
export const draftSessionQuery = defineQuery(draftSessionQueryDefinition());
/** The training calendar of a year. */
export const trainingCalendarQuery = defineQuery(trainingCalendarQueryDefinition());

/** Message keys the draft-session actions can return (platform + draft sessions). */
export const DELIVERY_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(DraftSessionErrors).map((def) => def.messageKey),
];

/** Raw error texts for the popups (`{correlationId}` stays a placeholder). */
export async function deliveryErrorTexts(locale: AppLocale): Promise<Record<string, string>> {
  const t = await getTranslations({ locale });
  return Object.fromEntries(DELIVERY_ERROR_KEYS.map((key) => [key, String(t.raw(key))]));
}

/**
 * The popups' raw texts: the `planDelivery` namespace, the course form's (`courses.*`: labels and field errors of
 * «Create course»), the delivery types and the shared words.
 */
export function deliveryTexts(locale: AppLocale): Record<string, string> {
  const messages = getMessages(locale);
  return {
    ...flattenTexts(messages.planDelivery),
    ...flattenTexts({ courses: messages.courses }),
    ...flattenTexts({ deliveryTypes: messages.courses.deliveryTypes }),
    required: messages.common.required,
    optional: messages.common.optional,
  };
}
