import { describe, expect, it } from 'vitest';
import {
  REFRESH_ON_RETURN,
  formTakesLatest,
  isVersionConflict,
  mayRefreshOnReturn,
} from './latest-version';

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

describe('formTakesLatest (review H1)', () => {
  it('an untouched form takes the newer copy the page loaded', () => {
    expect(formTakesLatest({ base: 4, current: 5, dirty: false })).toBe(true);
  });

  it('a form with typed entries keeps the version its fields were read at', () => {
    // Otherwise version 5 would sit under version-4 fields and the save would overwrite the other
    // person's change without a conflict.
    expect(formTakesLatest({ base: 4, current: 5, dirty: true })).toBe(false);
  });

  it('nothing changes while the page holds the same or an older copy', () => {
    expect(formTakesLatest({ base: 5, current: 5, dirty: false })).toBe(false);
    expect(formTakesLatest({ base: 5, current: 4, dirty: false })).toBe(false);
  });
});
