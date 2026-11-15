/**
 * Whether a cycle's page asks for «Courses and sessions» (WP-LD-04): once its plan is approved — and still while a
 * revised plan (a draft again, version 2 or more) is edited, as its drafts stay (review L1). A plan that was never
 * approved has no drafts, so the page does not ask. The page then shows the tab and the card only when the plan is
 * approved or has drafts (planDeliveryQuery's summary).
 */
export function asksPlanDelivery(
  plan: { readonly status: string; readonly planVersion: number } | null | undefined,
): boolean {
  if (!plan) return false;
  return plan.status !== 'draft' || plan.planVersion > 1;
}
