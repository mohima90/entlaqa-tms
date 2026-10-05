import { EMPTY_PERSON_SCOPE, isEmptyPersonScope } from '@jadarat/platform-core';
import { describe, expect, it } from 'vitest';
import { personResourceAttributes, personScopeFromGrants } from './person-scope';
import { platformPermissions } from './platform-permissions';

const read = platformPermissions['platform.user.read'];
const p = read.code;

describe('personScopeFromGrants', () => {
  it('is empty without grants and for scopes that cover no person', () => {
    expect(personScopeFromGrants([], read)).toEqual(EMPTY_PERSON_SCOPE);
    const scope = personScopeFromGrants(
      [
        { permission: p, scope: { type: 'assigned' } },
        { permission: p, scope: { type: 'legal_entity', legalEntityIds: ['l1'] } },
      ],
      read,
    );
    expect(isEmptyPersonScope(scope)).toBe(true);
  });

  it('unions every grant’s scope', () => {
    expect(
      personScopeFromGrants(
        [
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
        ],
        read,
      ),
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
    const scope = personScopeFromGrants([{ permission: p, scope: { type: 'tenant' } }], read);
    expect(scope.all).toBe(true);
    expect(isEmptyPersonScope(scope)).toBe(false);
  });

  it('ignores grants of other permissions', () => {
    const scope = personScopeFromGrants(
      [
        { permission: 'platform.org.read', scope: { type: 'tenant' } },
        { permission: p, scope: { type: 'direct_reports' } },
      ],
      read,
    );
    expect(scope).toEqual({ ...EMPTY_PERSON_SCOPE, directReports: true });
  });
});

describe('personResourceAttributes', () => {
  const facts = {
    personId: 'p1',
    tenantId: 't1',
    managerPersonId: 'm1',
    managerChain: ['m1', 'm0'],
    departmentId: 'd2',
    departmentAncestorIds: ['d1'],
    branchId: 'b1',
  };

  it('maps placement and manager chain to scope attributes', () => {
    expect(personResourceAttributes(facts)).toEqual({
      type: 'person',
      id: 'p1',
      tenantId: 't1',
      subjectPersonId: 'p1',
      subjectManagerPersonId: 'm1',
      subjectManagerChain: ['m1', 'm0'],
      orgUnitId: 'd2',
      orgUnitAncestorIds: ['d1'],
      branchId: 'b1',
    });
  });

  it('leaves out what the person does not have', () => {
    expect(
      personResourceAttributes({
        ...facts,
        managerPersonId: null,
        managerChain: [],
        departmentId: null,
        branchId: null,
      }),
    ).toEqual({
      type: 'person',
      id: 'p1',
      tenantId: 't1',
      subjectPersonId: 'p1',
      subjectManagerChain: [],
    });
  });
});
