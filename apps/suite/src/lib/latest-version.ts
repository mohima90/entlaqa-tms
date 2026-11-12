/**
 * «Here is the latest version» (WP-FIX-03; PO, 12 Nov 2026): the rules of the automatic reload, without
 * the browser (components/latest-version.tsx applies them).
 */

/** Was the change refused because the page was older than the data? */
export function isVersionConflict(error: { readonly code: string }): boolean {
  return error.code === 'CONFLICT_VERSION';
}

/**
 * Does a form take the newer copy the page just loaded? Only when nothing was typed in it: its fields then
 * show the latest values and it sends the latest version. A form with typed entries keeps the version its
 * fields were read at, so saving it is still refused as a conflict and «Load the latest version» is offered
 * — a reload must never put a newer version under older fields (review H1, 12 Nov 2026: the next save
 * would overwrite the other person's change unseen).
 */
export function formTakesLatest(state: {
  /** The version the form's fields were read at. */
  readonly base: number;
  /** The version the page holds now. */
  readonly current: number;
  readonly dirty: boolean;
}): boolean {
  return state.current > state.base && !state.dirty;
}

/** When a page reloads its data as the person comes back to the tab. */
export const REFRESH_ON_RETURN = {
  /** The tab was away at least this long (a glance at another tab changes nothing). */
  minAwayMs: 15_000,
  /** Never more often than this. */
  minIntervalMs: 30_000,
} as const;

/**
 * Should the page load the latest version now that its tab is shown again? Only after it was really away,
 * not too often, and never under a dialog or a panel or over unsaved entries.
 */
export function mayRefreshOnReturn(state: {
  /** How long the tab was hidden (null: it never was). */
  readonly awayMs: number | null;
  readonly sinceRefreshMs: number;
  readonly dialogOpen: boolean;
  readonly unsaved: boolean;
}): boolean {
  if (state.awayMs === null || state.awayMs < REFRESH_ON_RETURN.minAwayMs) return false;
  if (state.sinceRefreshMs < REFRESH_ON_RETURN.minIntervalMs) return false;
  return !state.dialogOpen && !state.unsaved;
}
