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

  it('drops the invitation token in the browser already (T-M2-07)', () => {
    const token = 'sample-invitation-token'.padEnd(43, '0'); // shape only
    const url = `https://app.example/en/invite/accept?token=${token}`;
    const scrubbed = browserErrorTrackingOptions().beforeSend?.(
      {
        type: undefined,
        request: { url, query_string: `token=${token}` },
        transaction: url,
        exception: {
          values: [{ type: 'Error', value: url, stacktrace: { frames: [{ filename: url }] } }],
        },
      },
      {},
    );
    expect(JSON.stringify(scrubbed)).not.toContain(token);
    expect(scrubbed).toMatchObject({ request: { url: 'https://app.example/en/invite/accept' } });
  });

  it('removes session, tracing and breadcrumb integrations', () => {
    const integrations = browserErrorTrackingOptions().integrations as (
      defaults: { name: string }[],
    ) => { name: string }[];
    const names = [
      'Breadcrumbs',
      'Console',
      'BrowserSession',
      'BrowserTracing',
      'GlobalHandlers',
      'Dedupe',
    ];
    expect(integrations(names.map((name) => ({ name }))).map(({ name }) => name)).toEqual([
      'GlobalHandlers',
      'Dedupe',
    ]);
  });
});
