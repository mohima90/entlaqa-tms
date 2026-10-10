import { appError } from '@jadarat/platform-core';
import { describe, expect, it } from 'vitest';
import {
  chooseForAll,
  deactivateInput,
  deactivationErrorKeys,
  initialDeactivateState,
  itemNames,
  missingOwners,
  reactivationErrorKey,
} from './deactivate-form';

const P = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const kinds = [
  { code: 'platform.direct_reports', blocked: false },
  { code: 'platform.headed_departments', blocked: false },
];
const invalid = (...fieldErrors: { path: string; code: string }[]) =>
  appError('VALIDATION_FAILED', { fieldErrors });

describe('deactivation form (T-M2-09, screen 4)', () => {
  it('«نقل الكل إلى» fills every kind; each can then be changed; the input carries the choices', () => {
    let state = initialDeactivateState(kinds);
    expect(missingOwners(state, kinds)).toEqual([
      'platform.direct_reports',
      'platform.headed_departments',
    ]);
    state = chooseForAll(state, kinds, A);
    expect(missingOwners(state, kinds)).toEqual([]);
    state = { ...state, owners: { ...state.owners, 'platform.headed_departments': B } };
    state = { ...state, reason: 'long_leave' };
    expect(deactivateInput(P, state, kinds)).toEqual({
      personId: P,
      reason: 'long_leave',
      reassign: [
        { kind: 'platform.direct_reports', toPersonId: A },
        { kind: 'platform.headed_departments', toPersonId: B },
      ],
    });
  });

  it('blocked kinds need no owner and are never sent; nothing to move → an empty list', () => {
    const blocked = [{ code: 'platform.direct_reports', blocked: true }];
    const state = initialDeactivateState(blocked);
    expect(missingOwners(state, blocked)).toEqual([]);
    expect(deactivateInput(P, chooseForAll(state, blocked, A), blocked).reassign).toEqual([]);
    expect(deactivateInput(P, initialDeactivateState([]), [])).toEqual({
      personId: P,
      reason: '',
      reassign: [],
    });
  });

  it('maps refusals to messages per kind and for the form', () => {
    expect(
      deactivationErrorKeys(
        invalid(
          { path: 'reassign.platform.direct_reports', code: 'OWNER_REPORTS_TO_PERSON' },
          { path: 'reassign.platform.headed_departments', code: 'OWNER_INVALID' },
        ),
        kinds,
      ),
    ).toEqual({
      form: null,
      kinds: {
        'platform.direct_reports': 'fieldErrors.ownerReportsToPerson',
        'platform.headed_departments': 'fieldErrors.ownerInvalid',
      },
    });
    expect(
      deactivationErrorKeys(
        invalid({ path: 'reassign.platform.direct_reports', code: 'OWNER_REQUIRED' }),
        kinds,
      ).kinds,
    ).toEqual({ 'platform.direct_reports': 'fieldErrors.ownerRequired' });
    expect(
      deactivationErrorKeys(
        invalid({ path: 'reassign.platform.direct_reports', code: 'NOT_ALLOWED' }),
        kinds,
      ).kinds,
    ).toEqual({ 'platform.direct_reports': 'itemsBlocked.item_not_allowed' });
    // Taken on after the page loaded, or an unknown kind: the page is out of date.
    expect(
      deactivationErrorKeys(
        invalid({ path: 'reassign.tms.sessions', code: 'OWNER_REQUIRED' }),
        kinds,
      ),
    ).toEqual({ form: 'fieldErrors.changed', kinds: {} });
    expect(
      deactivationErrorKeys(invalid({ path: 'reassign.0.kind', code: 'UNKNOWN' }), kinds).form,
    ).toBe('fieldErrors.changed');
    expect(
      deactivationErrorKeys(invalid({ path: 'personId', code: 'LAST_ADMIN' }), kinds).form,
    ).toBe('blocked.last_admin');
    expect(
      deactivationErrorKeys(invalid({ path: 'personId', code: 'NOT_ACTIVE' }), kinds).form,
    ).toBe('fieldErrors.notActive');
    expect(deactivationErrorKeys(appError('FORBIDDEN'), kinds)).toEqual({ form: null, kinds: {} });
  });

  it('maps reactivation refusals; anything else falls back to the general text', () => {
    expect(reactivationErrorKey(appError('STEP_UP_REQUIRED'))).toBe('reactivate.stepUp');
    expect(reactivationErrorKey(invalid({ path: 'personId', code: 'NOT_DEACTIVATED' }))).toBe(
      'reactivate.notDeactivated',
    );
    expect(reactivationErrorKey(invalid({ path: 'personId', code: 'PLACEMENT_DELETED' }))).toBe(
      'reactivate.placementDeleted',
    );
    expect(reactivationErrorKey(appError('FORBIDDEN'))).toBeNull();
  });

  it('lists the first names and how many more', () => {
    const more = (n: number) => `(+${String(n)})`;
    expect(itemNames(['أ', 'ب'], more, '، ')).toBe('أ، ب');
    expect(itemNames(['a', 'b', 'c', 'd', 'e'], more, ', ')).toBe('a, b, c (+2)');
  });
});
