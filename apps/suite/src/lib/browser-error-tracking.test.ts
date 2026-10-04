import { describe, expect, it } from 'vitest';
import { ERROR_TUNNEL_PATH, browserErrorTrackingOptions } from './browser-error-tracking';

describe('browserErrorTrackingOptions', () => {
  it('reports through the same-origin tunnel with collection off and scrubbing on', () => {
    const options = browserErrorTrackingOptions();
    expect(options.tunnel).toBe(ERROR_TUNNEL_PATH);
    expect(options.dsn).toMatch(/errors\.invalid/);
    expect(options).toMatchObject({
      sendClientReports: false,
      maxBreadcrumbs: 0,
      dataCollection: { userInfo: false, cookies: false, urlQueryParams: false },
    });
    expect(options.beforeBreadcrumb?.({ message: 'x' })).toBeNull();
    const scrubbed = options.beforeSend?.(
      { type: undefined, user: { email: 'a@b.co' }, request: { url: 'https://a/b?c=d' } },
      {},
    );
    expect(scrubbed).toEqual({ type: undefined, request: { url: 'https://a/b' } });
  });

  it('removes session, tracing and breadcrumb integrations', () => {
    const integrations = browserErrorTrackingOptions().integrations as (
      defaults: { name: string }[],
    ) => { name: string }[];
    const names = ['Breadcrumbs', 'BrowserSession', 'BrowserTracing', 'GlobalHandlers', 'Dedupe'];
    expect(integrations(names.map((name) => ({ name }))).map(({ name }) => name)).toEqual([
      'GlobalHandlers',
      'Dedupe',
    ]);
  });
});
