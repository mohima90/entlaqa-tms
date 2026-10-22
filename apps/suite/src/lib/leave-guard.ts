/** A click on a link, as the leave guard sees it. */
export interface LinkClick {
  readonly defaultPrevented: boolean;
  readonly button: number;
  /** Ctrl, Meta, Shift or Alt held (a new tab or window). */
  readonly modified: boolean;
  /** The link's resolved address. */
  readonly href: string;
  readonly target: string;
  readonly download: boolean;
}

/**
 * The address the leave guard holds back (redesign package 2, Q2-2): a plain left click on a link that
 * loads another page of this site in the same tab — not a new tab or window, a download, a jump on the
 * same page or another site. Null: let the click through.
 */
export function guardedHref(
  click: LinkClick,
  location: Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>,
): string | null {
  if (click.defaultPrevented || click.button !== 0 || click.modified || click.download) return null;
  if (click.target !== '' && click.target !== '_self') return null;
  const url = new URL(click.href, location.href);
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return url.href;
}
