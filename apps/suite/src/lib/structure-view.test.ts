import { describe, expect, it } from 'vitest';
import { levelName, nextLevel, parentIds, scopeUnitChoices, treeOrder } from './structure-view';

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
