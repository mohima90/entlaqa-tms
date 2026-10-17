/**
 * Organization structure (FR-ADM-05, T-M3-02; business flow EP-ORG, PO 17 Oct 2026) — client-safe helpers
 * shared by the structure page (server), its tree (client) and the unit picker of department-limited roles
 * (T-M3-09): the tree order, level names and the picker's choices.
 */

export interface LevelLabel {
  readonly ordinal: number;
  readonly nameEn: string;
  readonly nameAr: string;
}

export interface TreeNode {
  readonly id: string;
  readonly parentId: string | null;
}

/** A node with its depth (0 = a top unit) in depth-first order. */
export interface Placed<T> {
  readonly node: T;
  readonly depth: number;
}

/**
 * Depth-first order of a tree given as a flat list already sorted the way siblings should appear (parent,
 * sort order, name — the database's order). Nodes whose parent is missing (e.g. not readable) are shown at
 * the top so nothing silently disappears; a cycle (never stored: the database refuses it) cannot loop.
 */
export function treeOrder<T extends TreeNode>(nodes: readonly T[]): Placed<T>[] {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, T[]>();
  for (const node of nodes) {
    const key = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
    const list = children.get(key) ?? [];
    list.push(node);
    children.set(key, list);
  }
  const out: Placed<T>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The ids of the nodes that have children (expanded by default, as Kawadir does). */
export function parentIds(nodes: readonly TreeNode[]): string[] {
  return [...new Set(nodes.flatMap((n) => (n.parentId === null ? [] : [n.parentId])))];
}

/** A level's name in the page's language (the ordinal as a fallback for a level not read). */
export function levelName(
  levels: readonly LevelLabel[],
  ordinal: number | null,
  locale: 'ar' | 'en',
): string {
  const level = levels.find((l) => l.ordinal === ordinal);
  if (!level) return ordinal === null ? '' : String(ordinal);
  return locale === 'ar' ? level.nameAr : level.nameEn;
}

/** The level below `ordinal` (what «Add <next level>» adds), or null under the last level. */
export function nextLevel(
  levels: readonly LevelLabel[],
  ordinal: number | null,
): LevelLabel | null {
  return levels.find((l) => l.ordinal === (ordinal ?? 0) + 1) ?? null;
}

/** A unit as the picker offers it. */
export interface ScopeUnitSource extends TreeNode {
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly levelOrdinal: number | null;
  readonly active: boolean;
}

/** One choice of the unit picker: indented by depth, with its level; inactive units are not offered. */
export interface ScopeUnitChoice {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
}

/**
 * The picker's choices in tree order: «name (level)» indented with em spaces by depth (not read aloud),
 * every level offered (EP-ORG BR-ORG-d: any level; a higher unit covers everything under it).
 */
export function scopeUnitChoices(
  units: readonly ScopeUnitSource[],
  levels: readonly LevelLabel[],
  locale: 'ar' | 'en',
): ScopeUnitChoice[] {
  return treeOrder(units).map(({ node, depth }) => {
    const name = locale === 'en' ? (node.nameEn ?? node.nameAr) : node.nameAr;
    const level = levelName(levels, node.levelOrdinal, locale);
    return {
      id: node.id,
      label: `${' '.repeat(depth)}${level ? `${name} (${level})` : name}`,
      active: node.active,
    };
  });
}
