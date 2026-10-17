import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listStructureUnitOptions: vi.fn(() => Promise.resolve([{ id: 'u1', active: true }])),
  listStructureLevelLabels: vi.fn(() => Promise.resolve([{ ordinal: 1 }])),
}));
vi.mock('@jadarat/platform-db', () => db);

const { NO_SCOPE_UNITS, loadScopeUnitChoices, scopeUnitProblem } = await import('./scope-units');

describe('loadScopeUnitChoices (FR-IAM-08, T-M3-09)', () => {
  it('lists the units and levels for a giver who sees the structure', async () => {
    const choices = await loadScopeUnitChoices({ can: () => true, tx: {} as never });
    expect(choices).toEqual({
      units: [{ id: 'u1', active: true }],
      levels: [{ ordinal: 1 }],
      structureVisible: true,
    });
  });

  it('says the structure is hidden (not "no units") without platform.org.read (C-12)', async () => {
    db.listStructureUnitOptions.mockClear();
    const choices = await loadScopeUnitChoices({ can: () => false, tx: {} as never });
    expect(choices).toBe(NO_SCOPE_UNITS);
    expect(choices.structureVisible).toBe(false);
    expect(db.listStructureUnitOptions).not.toHaveBeenCalled();
  });
});

describe('scopeUnitProblem', () => {
  const units = [
    { id: 'a', active: true },
    { id: 'b', active: false },
  ] as never;
  it('a department-limited custom role needs one active unit; every other role none', () => {
    expect(scopeUnitProblem('departments', 'custom', null, units)).toBe('UNIT_REQUIRED');
    expect(scopeUnitProblem('departments', 'custom', 'b', units)).toBe('UNIT_NOT_ALLOWED');
    expect(scopeUnitProblem('departments', 'custom', 'a', units)).toBeNull();
    expect(scopeUnitProblem('organization', 'custom', 'a', units)).toBe('UNIT_NOT_ALLOWED');
    expect(scopeUnitProblem('departments', 'standard', null, units)).toBeNull();
  });
});
