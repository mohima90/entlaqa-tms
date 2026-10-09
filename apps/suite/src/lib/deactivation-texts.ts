import 'server-only';
import type { AppLocale } from '@jadarat/platform-i18n';
import { getTranslations } from 'next-intl/server';

/** Texts of the reactivate button (namespace `deactivation.reactivate`). */
const REACTIVATE_KEYS = [
  'button',
  'rowButton',
  'confirmButton',
  'keep',
  'working',
  'done',
  'stepUp',
  'notDeactivated',
  'placementDeleted',
] as const;

/** The reactivate button's texts (T-M2-09), for the profile and the users list; `confirm` raw (`{name}`). */
export async function reactivateLabels(locale: AppLocale): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'deactivation.reactivate' });
  const labels: Record<string, string> = Object.fromEntries(REACTIVATE_KEYS.map((k) => [k, t(k)]));
  labels.confirm = String(t.raw('confirm'));
  return labels;
}
