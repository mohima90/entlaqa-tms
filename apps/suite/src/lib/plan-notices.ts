import type { OrganizationPlan } from '@jadarat/platform-db';
import { gigabytes } from './storage-size';

/** A limit the organization is close to (from 90%) or has reached (WP-ADM-06, business flow D2). */
export interface PlanNotice {
  readonly kind: 'people' | 'storage';
  /** 100% or more: new people / files are refused now. */
  readonly reached: boolean;
  /** Already formatted (Latin digits). */
  readonly used: string;
  readonly limit: string;
  readonly percent: string;
}

/** The Organization Admin's home notices: each limit used to 90% or more. */
export function planNotices(plan: OrganizationPlan, locale = 'en'): PlanNotice[] {
  const numbers = new Intl.NumberFormat(`${locale}-u-nu-latn`);
  const notices: PlanNotice[] = [];
  if (plan.maxPeople !== null && plan.peopleUsed >= plan.maxPeople * 0.9) {
    notices.push({
      kind: 'people',
      reached: plan.peopleUsed >= plan.maxPeople,
      used: numbers.format(plan.peopleUsed),
      limit: numbers.format(plan.maxPeople),
      percent: numbers.format(Math.floor((plan.peopleUsed / plan.maxPeople) * 100)),
    });
  }
  const bytes = plan.maxStorageGb === null ? null : plan.maxStorageGb * 1024 ** 3;
  if (bytes !== null && plan.storageUsedBytes >= bytes * 0.9) {
    notices.push({
      kind: 'storage',
      reached: plan.storageUsedBytes >= bytes,
      used: gigabytes(plan.storageUsedBytes, locale),
      limit: numbers.format(plan.maxStorageGb ?? 0),
      percent: numbers.format(Math.floor((plan.storageUsedBytes / bytes) * 100)),
    });
  }
  return notices;
}
