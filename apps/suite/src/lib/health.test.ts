import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveResponse, readyResponse, resetReadyCache } from './health';

vi.mock('server-only', () => ({}));
vi.mock('@jadarat/platform-db', () => ({ checkDatabase: vi.fn(() => Promise.resolve('ok')) }));

afterEach(() => {
  resetReadyCache();
});

describe('health endpoints', () => {
  it('liveness answers ok, uncached', async () => {
    const response = liveResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('readiness is 200 when the database answers and 503 otherwise, without details', async () => {
    const ok = await readyResponse(
      () => Promise.resolve('ok'),
      () => 0,
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ status: 'ok' });

    resetReadyCache();
    for (const result of ['unavailable', 'not-configured'] as const) {
      resetReadyCache();
      const down = await readyResponse(
        () => Promise.resolve(result),
        () => 0,
      );
      expect(down.status).toBe(503);
      expect(down.headers.get('cache-control')).toBe('no-store');
      await expect(down.json()).resolves.toEqual({ status: 'unavailable' });
    }
  });

  it('reuses a probe result for 5 seconds', async () => {
    const check = vi.fn(() => Promise.resolve('ok' as const));
    await readyResponse(check, () => 1_000);
    await readyResponse(check, () => 5_999);
    expect(check).toHaveBeenCalledTimes(1);
    await readyResponse(check, () => 6_000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('shares one running probe between concurrent requests', async () => {
    let finish: (value: 'unavailable') => void = () => undefined;
    const check = vi.fn(
      () =>
        new Promise<'unavailable'>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = [readyResponse(check, () => 0), readyResponse(check, () => 0)];
    finish('unavailable');
    const responses = await Promise.all(pending);
    expect(check).toHaveBeenCalledTimes(1);
    expect(responses.map((response) => response.status)).toEqual([503, 503]);
  });

  it('treats a failing probe as unavailable', async () => {
    const response = await readyResponse(
      () => Promise.reject(new Error('boom')),
      () => 0,
    );
    expect(response.status).toBe(503);
  });

  it('uses the database probe by default', async () => {
    const response = await readyResponse();
    expect(response.status).toBe(200);
  });
});
