import { describe, expect, it } from 'vitest';
import {
  type BranchNode,
  branchCounts,
  branchFilterOf,
  branchTree,
  deleteBlockers,
  inFilter,
} from './branches-view';

const node = (id: string, parentBranchId: string | null, change: Partial<BranchNode> = {}) => ({
  id,
  parentBranchId,
  active: true,
  childCount: 0,
  unitCount: 0,
  peopleCount: 0,
  ...change,
});

describe('branches list (redesign package 2)', () => {
  it('puts each sub-branch under its parent, keeping the server order of siblings', () => {
    const list = [
      node('hq', null),
      node('dammam', null),
      node('jeddah', null),
      node('port', 'jeddah'),
      node('dock', 'port'),
      node('orphan', 'gone'),
    ];
    expect(branchTree(list).map(({ branch, depth }) => `${branch.id}:${String(depth)}`)).toEqual([
      'hq:0',
      'dammam:0',
      'jeddah:0',
      'port:1',
      'dock:2',
      'orphan:0',
    ]);
  });

  it('still lists branches only a loop reaches', () => {
    const tree = branchTree([node('a', 'b'), node('b', 'a')]);
    expect(tree.map(({ branch }) => branch.id).sort()).toEqual(['a', 'b']);
  });

  it('counts and filters by status from the list itself', () => {
    const list = [node('a', null), node('b', null, { active: false }), node('c', null)];
    expect(branchCounts(list)).toEqual({ all: 3, active: 2, inactive: 1 });
    expect(list.filter((b) => inFilter(b, 'inactive')).map((b) => b.id)).toEqual(['b']);
    expect(list.filter((b) => inFilter(b, 'all'))).toHaveLength(3);
    expect(branchFilterOf('active')).toBe('active');
    expect(branchFilterOf(['inactive'])).toBe('all');
    expect(branchFilterOf(undefined)).toBe('all');
  });

  it('says what keeps a branch from being deleted', () => {
    expect(deleteBlockers(node('a', null))).toEqual([]);
    expect(deleteBlockers(node('a', null, { childCount: 1, peopleCount: 86 }))).toEqual([
      { key: 'remove.inUseBranches', count: 1 },
      { key: 'remove.inUsePeople', count: 86 },
    ]);
  });
});
