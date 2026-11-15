import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import { personDisplayName } from '@jadarat/platform-i18n/names';
import type { ApprovalPerson, PlanApprovalView } from '@jadarat/tms';

/**
 * The plan approval's screens (WP-LD-03, T-M3-07; approved designs 4–6b of
 * docs/design/screens/m3-consolidation-approval/README.md): pure helpers shared by the server pages and the client
 * components — a person's name in the page's language, every moment of an approval formatted once on the server
 * (the organization's calendar and time zone), and the addresses of the approval pages.
 */

export const APPROVAL_PATHS = {
  approvals: '/suite/approvals',
} as const;

/** The review of a cycle's plan (design 5b). */
export function approvalReviewHref(locale: AppLocale, cycleId: string): string {
  return `/${locale}${APPROVAL_PATHS.approvals}/${cycleId}`;
}

/** An approved version of a cycle's plan, read only. */
export function planVersionHref(locale: AppLocale, cycleId: string, planVersion: number): string {
  return `/${locale}/suite/planning/cycles/${cycleId}/versions/${String(planVersion)}`;
}

/** A person as shown (the page's language first, the other one otherwise), or the fallback. */
export function personLabel(
  locale: AppLocale,
  person: Pick<ApprovalPerson, 'name'> | null | undefined,
  fallback: string,
): string {
  if (!person) return fallback;
  return personDisplayName(locale, person.name.ar, person.name.en) || fallback;
}

/** Every moment of an approval (ISO → as shown), formatted on the server for the client components. */
export function approvalMoments(
  view: PlanApprovalView | null,
  format: DisplayDateFormatter,
): Record<string, string> {
  if (!view) return {};
  const moments = [
    view.plan.submittedAt,
    view.plan.decidedAt,
    view.plan.approvedAt,
    view.steps.hr.decidedAt,
    view.steps.finance.decidedAt,
    ...view.events.map((e) => e.at),
    ...view.versions.map((v) => v.approvedAt),
  ].filter((value): value is string => value !== null);
  return Object.fromEntries(moments.map((value) => [value, format.dateTime(value)]));
}

/** The names of a step's deciders, joined («Khalid Omar or Mona Adel»), the viewer marked. */
export function decidersLabel(
  locale: AppLocale,
  people: readonly ApprovalPerson[],
  separator: string,
  viewerPersonId: string | null = null,
  you: (name: string) => string = (name) => name,
): string {
  return people
    .map((p) => {
      const name = personLabel(locale, p, '—');
      return p.personId === viewerPersonId ? you(name) : name;
    })
    .join(separator);
}
