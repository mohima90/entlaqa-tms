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

// ---------------------------------------------------------------------------------------------------
// The organization's own level names instead of a fixed «Department» (guided-test feedback #3, PO 17 Oct
// 2026): a column or field that can hold units of any level is labelled with the first level's name when
// every unit in it is at the first level, else with a neutral word («Unit» / «الوحدة») — and then each row
// shows its own level («Retail Sales · Unit»).
// ---------------------------------------------------------------------------------------------------

/** The top level (lowest ordinal), or null without levels. */
function firstLevel(levels: readonly LevelLabel[]): LevelLabel | null {
  return levels.reduce<LevelLabel | null>(
    (top, level) => (top === null || level.ordinal < top.ordinal ? level : top),
    null,
  );
}

/**
 * Do these units need their level shown next to their names? Yes when one of them is not at the first
 * level (unknown levels count as not first), so a neutral column label still tells which level each is.
 */
export function showsUnitLevels(
  levels: readonly LevelLabel[],
  ordinals: readonly (number | null)[],
): boolean {
  const top = firstLevel(levels);
  return top === null || ordinals.some((ordinal) => ordinal !== top.ordinal);
}

/**
 * The label of a column or field holding these units: the first level's name when all are at the first
 * level (also with no unit at all: what the organization starts with), else `neutral` («Unit»).
 */
export function unitsLabel(
  levels: readonly LevelLabel[],
  ordinals: readonly (number | null)[],
  locale: 'ar' | 'en',
  neutral: string,
): string {
  const top = firstLevel(levels);
  if (top === null || showsUnitLevels(levels, ordinals)) return neutral;
  return locale === 'ar' ? top.nameAr : top.nameEn;
}

/**
 * For a list shown page by page (the users list): do its units show their level? Decided for the whole
 * organization — it has a unit below the first level (`unitsBelowFirstLevel`) — so the column does not change
 * from one page to the next.
 */
export function orgShowsUnitLevels(
  levels: readonly LevelLabel[],
  unitsBelowFirstLevel: boolean,
): boolean {
  return firstLevel(levels) === null || unitsBelowFirstLevel;
}

/** The label of such a column: the first level's name, or `neutral` («Unit») when units are deeper. */
export function orgUnitsLabel(
  levels: readonly LevelLabel[],
  unitsBelowFirstLevel: boolean,
  locale: 'ar' | 'en',
  neutral: string,
): string {
  const top = firstLevel(levels);
  if (top === null || unitsBelowFirstLevel) return neutral;
  return locale === 'ar' ? top.nameAr : top.nameEn;
}

/** The label of a field holding one unit:that unit's level name, else `neutral` (no unit, unknown level). */
export function unitFieldLabel(
  levels: readonly LevelLabel[],
  ordinal: number | null,
  locale: 'ar' | 'en',
  neutral: string,
): string {
  const level = levels.find((l) => l.ordinal === ordinal);
  return level ? (locale === 'ar' ? level.nameAr : level.nameEn) : neutral;
}

/** A unit's name, followed by its level when `show` («Retail Sales · Unit»). */
export function unitNameWithLevel(
  name: string,
  ordinal: number | null,
  levels: readonly LevelLabel[],
  locale: 'ar' | 'en',
  show: boolean,
): string {
  if (!show) return name;
  const level = levels.find((l) => l.ordinal === ordinal);
  return level ? `${name} · ${locale === 'ar' ? level.nameAr : level.nameEn}` : name;
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
