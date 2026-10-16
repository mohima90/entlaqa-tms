import type { IconName } from './icons';

/** The command palette's data (no React: usable on the server, e.g. to build the item list). */
export interface CommandPaletteItem {
  /** Stable and unique (e.g. the page key). */
  readonly id: string;
  readonly label: string;
  /** The menu group it belongs to (e.g. «الإعدادات» / "Settings"); shown as the group heading. */
  readonly group: string;
  readonly href: string;
  readonly icon?: IconName | undefined;
}

/** Ctrl+K, or ⌘K on Apple devices. */
export function isPaletteShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>) {
  return event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey);
}

/** Groups in first-seen order, items in their given order. */
export function groupItems(
  items: readonly CommandPaletteItem[],
): readonly { readonly group: string; readonly items: readonly CommandPaletteItem[] }[] {
  const groups = new Map<string, CommandPaletteItem[]>();
  for (const item of items) {
    const list = groups.get(item.group);
    if (list) list.push(item);
    else groups.set(item.group, [item]);
  }
  return [...groups].map(([group, list]) => ({ group, items: list }));
}
