import { codeIsFresh } from '@jadarat/platform-core';

/**
 * Ask for the authenticator code BEFORE editing (redesign package 2, PO answer Q2-1, 21 Oct 2026): a
 * settings page shows the «Verify with the app» banner and keeps its form read-only when saving would
 * be refused for want of a fresh code. Same rule as the server's (defineAction: an AAL2 permission
 * needs AAL2 and a code from the last STEP_UP_MAX_AGE_SECONDS), only asked earlier. A permission that
 * does not require AAL2 — today every organization setting (PO decision, 14 Oct 2026) — never asks.
 * Without claims (the preview without data) nothing is asked either. The server still checks on Save.
 */
export function stepUpNeeded(
  permission: { readonly requiresAal2: boolean },
  claims: object | null,
  now: Date = new Date(),
): boolean {
  if (!permission.requiresAal2 || claims === null) return false;
  const aal = 'aal' in claims ? claims.aal : undefined;
  return !(aal === 'aal2' && codeIsFresh(claims, now));
}
