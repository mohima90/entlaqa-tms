import { describe, expect, it } from 'vitest';
import { headUnitDefault, headUnitErrorKey, headUnitView, unitLabel } from './head-unit';

describe('«Head of which department?» helpers (WP-FIX-03)', () => {
  it('names every head in the page language, falling back to the other one', () => {
    const view = headUnitView(
      {
        canPick: true,
        ownUnitId: 'u2',
        headedUnitIds: [],
        heads: [
          { unitId: 'u1', personId: 'p1', nameAr: 'سارة', nameEn: 'Sarah' },
          { unitId: 'u2', personId: 'p2', nameAr: null, nameEn: 'Omar' },
          { unitId: 'u3', personId: 'p3', nameAr: 'ليلى', nameEn: null },
          { unitId: 'u4', personId: 'p4', nameAr: null, nameEn: null },
        ],
      },
      'ar',
    );
    expect(view.canPick).toBe(true);
    expect(view.ownUnitId).toBe('u2');
    expect(view.heads.map((h) => h.name)).toEqual(['سارة', 'Omar', 'ليلى', '']);
    expect(
      headUnitView(
        {
          canPick: false,
          ownUnitId: null,
          headedUnitIds: [],
          heads: [{ unitId: 'u3', personId: 'p3', nameAr: 'ليلى', nameEn: null }],
        },
        'en',
      ),
    ).toEqual({
      canPick: false,
      ownUnitId: null,
      heads: [{ unitId: 'u3', personId: 'p3', name: 'ليلى' }],
    });
  });

  it("opens on the person's own department: the role makes them its head (PO, 12 Nov 2026)", () => {
    const units = [
      { id: 'own', active: true },
      { id: 'other', active: true },
      { id: 'closed', active: false },
    ];
    const base = { picked: '', ownUnitId: 'own', headsSomething: false, units };
    // Left as it opens: their own department.
    expect(headUnitDefault(base)).toBe('own');
    // Another department can still be chosen.
    expect(headUnitDefault({ ...base, picked: 'other' })).toBe('other');
    // No department: nothing to default to — the form asks.
    expect(headUnitDefault({ ...base, ownUnitId: null })).toBe('');
    // Someone who heads departments already keeps them; nothing is added unless picked.
    expect(headUnitDefault({ ...base, headsSomething: true })).toBe('');
    expect(headUnitDefault({ ...base, headsSomething: true, picked: 'other' })).toBe('other');
    // An inactive department, or one the picker does not offer, is never the default.
    expect(headUnitDefault({ ...base, ownUnitId: 'closed' })).toBe('');
    expect(headUnitDefault({ ...base, ownUnitId: 'gone' })).toBe('');
  });

  it('maps the server codes to texts, anything unknown to «cannot be picked»', () => {
    expect(headUnitErrorKey('HEAD_UNIT_REQUIRED')).toBe('required');
    expect(headUnitErrorKey('HEAD_TAKEN')).toBe('taken');
    expect(headUnitErrorKey('HEAD_NOT_ACTIVE')).toBe('notActive');
    expect(headUnitErrorKey('HEAD_NOT_YOURS')).toBe('notYours');
    expect(headUnitErrorKey('UNIT_NOT_ALLOWED')).toBe('notAllowed');
    expect(headUnitErrorKey('SOMETHING_ELSE')).toBe('notAllowed');
  });

  it('drops the tree indentation of a picker label', () => {
    expect(unitLabel('  Finance (Division)')).toBe('Finance (Division)');
    expect(unitLabel('Sales')).toBe('Sales');
  });
});
