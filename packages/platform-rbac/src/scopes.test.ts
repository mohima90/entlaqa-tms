import { describe, expect, it } from 'vitest';
import { type ResourceAttributes, scopeCovers } from './scopes';

const me = 'p-me';
const base: ResourceAttributes = { type: 'enrollment', id: 'e1', tenantId: 't1' };

describe('scopeCovers (every scope type, ADR 0003 §3)', () => {
  it('tenant covers everything in the tenant', () => {
    expect(scopeCovers({ type: 'tenant' }, null, base)).toBe(true);
  });

  it('own covers only records about the member', () => {
    expect(scopeCovers({ type: 'own' }, me, { ...base, subjectPersonId: me })).toBe(true);
    expect(scopeCovers({ type: 'own' }, me, { ...base, subjectPersonId: 'other' })).toBe(false);
    expect(scopeCovers({ type: 'own' }, null, { ...base, subjectPersonId: me })).toBe(false);
    expect(scopeCovers({ type: 'own' }, me, base)).toBe(false);
  });

  it('direct_reports covers persons whose direct manager is the member', () => {
    expect(
      scopeCovers({ type: 'direct_reports' }, me, { ...base, subjectManagerPersonId: me }),
    ).toBe(true);
    expect(
      scopeCovers({ type: 'direct_reports' }, me, { ...base, subjectManagerChain: ['x', me] }),
    ).toBe(false);
    expect(scopeCovers({ type: 'direct_reports' }, null, base)).toBe(false);
  });

  it('reports_tree covers direct and indirect reports (manager changes reflected by data)', () => {
    expect(scopeCovers({ type: 'reports_tree' }, me, { ...base, subjectManagerPersonId: me })).toBe(
      true,
    );
    expect(
      scopeCovers({ type: 'reports_tree' }, me, { ...base, subjectManagerChain: ['x', me] }),
    ).toBe(true);
    expect(scopeCovers({ type: 'reports_tree' }, me, { ...base, subjectManagerChain: ['x'] })).toBe(
      false,
    );
    expect(scopeCovers({ type: 'reports_tree' }, me, base)).toBe(false);
    expect(scopeCovers({ type: 'reports_tree' }, null, base)).toBe(false);
  });

  it('org_units covers listed units, and descendants only when enabled', () => {
    const scope = { type: 'org_units', orgUnitIds: ['ou-1'], includeDescendants: false } as const;
    expect(scopeCovers(scope, me, { ...base, orgUnitId: 'ou-1' })).toBe(true);
    expect(
      scopeCovers(scope, me, { ...base, orgUnitId: 'ou-2', orgUnitAncestorIds: ['ou-1'] }),
    ).toBe(false);
    expect(
      scopeCovers({ ...scope, includeDescendants: true }, me, {
        ...base,
        orgUnitId: 'ou-2',
        orgUnitAncestorIds: ['ou-1'],
      }),
    ).toBe(true);
    expect(
      scopeCovers({ ...scope, includeDescendants: true }, me, { ...base, orgUnitId: 'ou-9' }),
    ).toBe(false);
    expect(scopeCovers(scope, me, base)).toBe(false);
  });

  it('branches and legal_entity cover listed ids only', () => {
    expect(
      scopeCovers({ type: 'branches', branchIds: ['b1'] }, me, { ...base, branchId: 'b1' }),
    ).toBe(true);
    expect(
      scopeCovers({ type: 'branches', branchIds: ['b1'] }, me, { ...base, branchId: 'b2' }),
    ).toBe(false);
    expect(scopeCovers({ type: 'branches', branchIds: ['b1'] }, me, base)).toBe(false);
    expect(
      scopeCovers({ type: 'legal_entity', legalEntityIds: ['le1'] }, me, {
        ...base,
        legalEntityId: 'le1',
      }),
    ).toBe(true);
    expect(scopeCovers({ type: 'legal_entity', legalEntityIds: ['le1'] }, me, base)).toBe(false);
  });

  it('assigned covers resources explicitly assigned to the member', () => {
    expect(scopeCovers({ type: 'assigned' }, me, { ...base, assigneePersonIds: [me] })).toBe(true);
    expect(scopeCovers({ type: 'assigned' }, me, { ...base, assigneePersonIds: ['x'] })).toBe(
      false,
    );
    expect(scopeCovers({ type: 'assigned' }, me, base)).toBe(false);
    expect(scopeCovers({ type: 'assigned' }, null, { ...base, assigneePersonIds: [me] })).toBe(
      false,
    );
  });
});
