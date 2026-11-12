import { describe, expect, it } from 'vitest';
import { headUnitErrorKey, headUnitView, unitLabel } from './head-unit';

describe('«Head of which department?» helpers (WP-FIX-03)', () => {
  it('names every head in the page language, falling back to the other one', () => {
    const view = headUnitView(
      {
        canPick: true,
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
    expect(view.heads.map((h) => h.name)).toEqual(['سارة', 'Omar', 'ليلى', '']);
    expect(
      headUnitView(
        {
          canPick: false,
          headedUnitIds: [],
          heads: [{ unitId: 'u3', personId: 'p3', nameAr: 'ليلى', nameEn: null }],
        },
        'en',
      ),
    ).toEqual({ canPick: false, heads: [{ unitId: 'u3', personId: 'p3', name: 'ليلى' }] });
  });

  it('maps the server codes to texts, anything unknown to «cannot be picked»', () => {
    expect(headUnitErrorKey('HEAD_UNIT_REQUIRED')).toBe('required');
    expect(headUnitErrorKey('HEAD_TAKEN')).toBe('taken');
    expect(headUnitErrorKey('HEAD_NOT_ACTIVE')).toBe('notActive');
    expect(headUnitErrorKey('UNIT_NOT_ALLOWED')).toBe('notAllowed');
    expect(headUnitErrorKey('SOMETHING_ELSE')).toBe('notAllowed');
  });

  it('drops the tree indentation of a picker label', () => {
    expect(unitLabel('  Finance (Division)')).toBe('Finance (Division)');
    expect(unitLabel('Sales')).toBe('Sales');
  });
});
