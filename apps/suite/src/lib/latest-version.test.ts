import { describe, expect, it } from 'vitest';
import { REFRESH_ON_RETURN, isVersionConflict, mayRefreshOnReturn } from './latest-version';

describe('the automatic reload (WP-FIX-03)', () => {
  it('knows a version conflict from any other refusal', () => {
    expect(isVersionConflict({ code: 'CONFLICT_VERSION' })).toBe(true);
    expect(isVersionConflict({ code: 'VALIDATION_FAILED' })).toBe(false);
    expect(isVersionConflict({ code: 'UNAUTHENTICATED' })).toBe(false);
  });

  const back = {
    awayMs: REFRESH_ON_RETURN.minAwayMs,
    sinceRefreshMs: REFRESH_ON_RETURN.minIntervalMs,
    dialogOpen: false,
    unsaved: false,
  };

  it('reloads when the person comes back after a while', () => {
    expect(mayRefreshOnReturn(back)).toBe(true);
  });

  it('does not reload for a glance at another tab, or a tab that was never away', () => {
    expect(mayRefreshOnReturn({ ...back, awayMs: REFRESH_ON_RETURN.minAwayMs - 1 })).toBe(false);
    expect(mayRefreshOnReturn({ ...back, awayMs: null })).toBe(false);
  });

  it('does not reload again within half a minute', () => {
    expect(
      mayRefreshOnReturn({ ...back, sinceRefreshMs: REFRESH_ON_RETURN.minIntervalMs - 1 }),
    ).toBe(false);
  });

  it('never reloads under an open dialog or panel, or over unsaved entries', () => {
    expect(mayRefreshOnReturn({ ...back, dialogOpen: true })).toBe(false);
    expect(mayRefreshOnReturn({ ...back, unsaved: true })).toBe(false);
  });
});
