import 'server-only';
import { cache } from 'react';
import { getConfigStatus } from './config-status';
import { type SessionState, getSessionState } from './session-state';

/**
 * The request's session state, read once per request (React `cache`): the suite pages and their layout's
 * metadata (the organization's favicon, WP-ADM-02) share one read of the session, the tenant and its look.
 */
export const requestSessionState = cache((): Promise<SessionState> =>
  getSessionState(getConfigStatus()),
);
