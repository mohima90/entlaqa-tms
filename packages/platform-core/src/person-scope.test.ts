import { describe, expect, it } from 'vitest';
import { EMPTY_PERSON_SCOPE, isEmptyPersonScope } from './person-scope';

describe('isEmptyPersonScope', () => {
  it('is true only when no part covers anyone', () => {
    expect(isEmptyPersonScope(EMPTY_PERSON_SCOPE)).toBe(true);
    expect(
      isEmptyPersonScope({
        ...EMPTY_PERSON_SCOPE,
        departments: [{ ids: [], includeDescendants: true }],
      }),
    ).toBe(true);
    for (const scope of [
      { ...EMPTY_PERSON_SCOPE, all: true },
      { ...EMPTY_PERSON_SCOPE, self: true },
      { ...EMPTY_PERSON_SCOPE, directReports: true },
      { ...EMPTY_PERSON_SCOPE, reportsTree: true },
      { ...EMPTY_PERSON_SCOPE, departments: [{ ids: ['d'], includeDescendants: false }] },
      { ...EMPTY_PERSON_SCOPE, branchIds: ['b'] },
    ]) {
      expect(isEmptyPersonScope(scope)).toBe(false);
    }
  });
});
