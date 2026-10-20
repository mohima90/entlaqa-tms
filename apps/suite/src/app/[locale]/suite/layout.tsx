import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { brandAssetPath } from '../../../lib/branding-view';
import { requestSessionState } from '../../../lib/request-session';

/**
 * The suite's browser-tab icon (WP-ADM-02, FR-ADM-07): the organization's favicon (its published copy,
 * /api/brand/<id>) — Jadarat's (app/icon.svg) until it has one. The session is read once per request
 * (shared with the page). The page itself renders the shell.
 */
export async function generateMetadata(): Promise<Metadata> {
  const session = await requestSessionState();
  const favicon =
    session.kind === 'organization' ? brandAssetPath(session.brand?.faviconAssetId) : null;
  return favicon ? { icons: { icon: [{ url: favicon }], shortcut: [{ url: favicon }] } } : {};
}

export default function SuiteLayout({ children }: { children: ReactNode }) {
  return children;
}
