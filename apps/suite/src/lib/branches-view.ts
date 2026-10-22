/** Organization → Branches, the list's view (redesign package 2; FR-ADM-04), client-safe. */

/** What the list needs of a branch. */
export interface BranchNode {
  readonly id: string;
  readonly parentBranchId: string | null;
  readonly active: boolean;
  readonly childCount: number;
  readonly unitCount: number;
  readonly peopleCount: number;
}

export type BranchFilter = 'all' | 'active' | 'inactive';

/** The status filter of the address (`?status=`); anything else is «All». */
export function branchFilterOf(value: unknown): BranchFilter {
  return value === 'active' || value === 'inactive' ? value : 'all';
}

/**
 * The branches in the list's order: each sub-branch right under its parent, one step further in
 * (`depth`), siblings in the order the server gave (the headquarters first, then by name). A branch whose
 * parent is not in the list (or a loop the database refuses anyway) starts a group of its own.
 */
export function branchTree<B extends BranchNode>(
  branches: readonly B[],
): { readonly branch: B; readonly depth: number }[] {
  const ids = new Set(branches.map((b) => b.id));
  const children = new Map<string, B[]>();
  for (const branch of branches) {
    if (branch.parentBranchId && ids.has(branch.parentBranchId)) {
      const list = children.get(branch.parentBranchId) ?? [];
      list.push(branch);
      children.set(branch.parentBranchId, list);
    }
  }
  const out: { branch: B; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (branch: B, depth: number) => {
    if (seen.has(branch.id)) return;
    seen.add(branch.id);
    out.push({ branch, depth });
    for (const child of children.get(branch.id) ?? []) visit(child, depth + 1);
  };
  for (const branch of branches) {
    if (!branch.parentBranchId || !ids.has(branch.parentBranchId)) visit(branch, 0);
  }
  // Whatever only a loop reaches is still listed.
  for (const branch of branches) visit(branch, 0);
  return out;
}

/** How many branches each status filter holds (from the list itself). */
export function branchCounts(branches: readonly BranchNode[]): Record<BranchFilter, number> {
  const active = branches.filter((b) => b.active).length;
  return { all: branches.length, active, inactive: branches.length - active };
}

/** Does a branch pass the status filter? */
export function inFilter(branch: BranchNode, filter: BranchFilter): boolean {
  return filter === 'all' || (filter === 'active') === branch.active;
}

/**
 * What still belongs to a branch and keeps it from being deleted (message key and count), in the order
 * the page lists them; empty: it can be deleted.
 */
export function deleteBlockers(
  branch: BranchNode,
): { readonly key: string; readonly count: number }[] {
  return [
    { key: 'remove.inUseBranches', count: branch.childCount },
    { key: 'remove.inUseUnits', count: branch.unitCount },
    { key: 'remove.inUsePeople', count: branch.peopleCount },
  ].filter((item) => item.count > 0);
}
