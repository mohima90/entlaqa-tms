import { describe, expect, it } from 'vitest';
import {
  levelName,
  nextLevel,
  orgShowsUnitLevels,
  orgUnitsLabel,
  parentIds,
  scopeUnitChoices,
  showsUnitLevels,
  treeOrder,
  unitNameWithLevel,
  unitsLabel,
} from './structure-view';

const levels = [
  { ordinal: 1, nameEn: 'Sector', nameAr: 'قطاع' },
  { ordinal: 2, nameEn: 'Department', nameAr: 'إدارة' },
  { ordinal: 3, nameEn: 'Section', nameAr: 'قسم' },
];
const unit = (id: string, parentId: string | null, levelOrdinal: number, active = true) => ({
  id,
  parentId,
  nameAr: `و-${id}`,
  nameEn: id === 'c' ? null : `U-${id}`,
  levelOrdinal,
  active,
});

describe('treeOrder', () => {
  it('orders depth-first, keeping the siblings’ order, with depths', () => {
    const units = [
      unit('a', null, 1),
      unit('b', null, 1),
      unit('a1', 'a', 2),
      unit('a1x', 'a1', 3),
      unit('b1', 'b', 2),
    ];
    expect(treeOrder(units).map(({ node, depth }) => `${node.id}:${depth}`)).toEqual([
      'a:0',
      'a1:1',
      'a1x:2',
      'b:0',
      'b1:1',
    ]);
  });

  it('shows units whose parent is not in the list at the top and never loops', () => {
    expect(treeOrder([unit('x', 'gone', 2)]).map((p) => p.depth)).toEqual([0]);
    const cycle = [unit('p', 'q', 1), unit('q', 'p', 1)];
    expect(treeOrder(cycle)).toEqual([]);
  });

  it('lists the parents (expanded by default)', () => {
    expect(parentIds([unit('a', null, 1), unit('a1', 'a', 2), unit('a2', 'a', 2)])).toEqual(['a']);
  });
});

describe('levels', () => {
  it('names a level in the page language and finds the next one', () => {
    expect(levelName(levels, 2, 'en')).toBe('Department');
    expect(levelName(levels, 2, 'ar')).toBe('إدارة');
    expect(levelName(levels, 9, 'en')).toBe('9');
    expect(levelName(levels, null, 'en')).toBe('');
    expect(nextLevel(levels, null)?.nameEn).toBe('Sector');
    expect(nextLevel(levels, 1)?.nameEn).toBe('Department');
    expect(nextLevel(levels, 3)).toBeNull();
  });
});

describe('scopeUnitChoices (T-M3-09)', () => {
  it('indents by depth, names the level, falls back to Arabic, keeps inactive units marked', () => {
    const choices = scopeUnitChoices(
      [unit('a', null, 1), unit('c', 'a', 2, false), unit('a2', 'a', 2)],
      levels,
      'en',
    );
    expect(choices).toEqual([
      { id: 'a', label: 'U-a (Sector)', active: true },
      { id: 'c', label: ' و-c (Department)', active: false },
      { id: 'a2', label: ' U-a2 (Department)', active: true },
    ]);
    expect(scopeUnitChoices([unit('a', null, 1)], levels, 'ar')[0]?.label).toBe('و-a (قطاع)');
  });
});

describe('the organization’s own level names (guided-test feedback #3)', () => {
  it('labels a column with the first level’s name while every unit is at the first level', () => {
    expect(unitsLabel(levels, [1, 1], 'en', 'Unit')).toBe('Sector');
    expect(unitsLabel(levels, [1], 'ar', 'الوحدة')).toBe('قطاع');
    // No unit yet: the name the organization starts with.
    expect(unitsLabel(levels, [], 'en', 'Unit')).toBe('Sector');
    expect(showsUnitLevels(levels, [1, 1])).toBe(false);
  });

  it('uses the neutral word when levels mix, and each row then shows its level', () => {
    expect(unitsLabel(levels, [1, 2], 'en', 'Unit')).toBe('Unit');
    expect(unitsLabel(levels, [2, 2], 'ar', 'الوحدة')).toBe('الوحدة');
    expect(unitsLabel(levels, [1, null], 'en', 'Unit')).toBe('Unit');
    expect(unitsLabel([], [1], 'en', 'Unit')).toBe('Unit');
    expect(showsUnitLevels(levels, [1, 2])).toBe(true);
    expect(unitNameWithLevel('Retail Sales', 2, levels, 'en', true)).toBe(
      'Retail Sales · Department',
    );
    expect(unitNameWithLevel('مبيعات التجزئة', 3, levels, 'ar', true)).toBe('مبيعات التجزئة · قسم');
    expect(unitNameWithLevel('Retail Sales', 2, levels, 'en', false)).toBe('Retail Sales');
    expect(unitNameWithLevel('Retail Sales', 9, levels, 'en', true)).toBe('Retail Sales');
  });

  it('a paged list decides for the organization, not for the rows of one page', () => {
    // Only first-level units in the organization: the first level's name, no level per row.
    expect(orgUnitsLabel(levels, false, 'en', 'Unit')).toBe('Sector');
    expect(orgUnitsLabel(levels, false, 'ar', 'الوحدة')).toBe('قطاع');
    expect(orgShowsUnitLevels(levels, false)).toBe(false);
    // A deeper unit anywhere: «Unit» on every page, and each row says its level.
    expect(orgUnitsLabel(levels, true, 'en', 'Unit')).toBe('Unit');
    expect(orgShowsUnitLevels(levels, true)).toBe(true);
    // No levels (before the migration): the neutral word.
    expect(orgUnitsLabel([], false, 'en', 'Unit')).toBe('Unit');
    expect(orgShowsUnitLevels([], false)).toBe(true);
  });
});
