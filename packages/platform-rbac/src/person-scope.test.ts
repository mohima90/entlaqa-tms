import { EMPTY_PERSON_SCOPE, isEmptyPersonScope } from '@jadarat/platform-core';
import { describe, expect, it } from 'vitest';
import { personScopeFromGrants } from './person-scope';

const p = 'platform.user.read';

describe('personScopeFromGrants', () => {
  it('is empty without grants and for scopes that cover no person', () => {
    expect(personScopeFromGrants([])).toEqual(EMPTY_PERSON_SCOPE);
    const scope = personScopeFromGrants([
      { permission: p, scope: { type: 'assigned' } },
      { permission: p, scope: { type: 'legal_entity', legalEntityIds: ['l1'] } },
    ]);
    expect(isEmptyPersonScope(scope)).toBe(true);
  });

  it('unions every grant’s scope', () => {
    expect(
      personScopeFromGrants([
        { permission: p, scope: { type: 'own' } },
        { permission: p, scope: { type: 'direct_reports' } },
        { permission: p, scope: { type: 'reports_tree' } },
        {
          permission: p,
          scope: { type: 'org_units', orgUnitIds: ['d1'], includeDescendants: true },
        },
        {
          permission: p,
          scope: { type: 'org_units', orgUnitIds: ['d2'], includeDescendants: false },
        },
        { permission: p, scope: { type: 'branches', branchIds: ['b1'] } },
      ]),
    ).toEqual({
      all: false,
      self: true,
      directReports: true,
      reportsTree: true,
      departments: [
        { ids: ['d1'], includeDescendants: true },
        { ids: ['d2'], includeDescendants: false },
      ],
      branchIds: ['b1'],
    });
  });

  it('marks a tenant grant as everyone', () => {
    const scope = personScopeFromGrants([{ permission: p, scope: { type: 'tenant' } }]);
    expect(scope.all).toBe(true);
    expect(isEmptyPersonScope(scope)).toBe(false);
  });
});
