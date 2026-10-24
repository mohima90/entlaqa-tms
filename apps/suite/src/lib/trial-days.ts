/**
 * Whole days left of a trial (WP-ADM-06): 0 on its last day, never negative; null without an end date.
 * Counted on the server at render time (the worker suspends the organization once it has passed).
 */
export function trialDaysLeft(endsAt: Date | null, now: Date = new Date()): number | null {
  if (endsAt === null) return null;
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000) - 1);
}
