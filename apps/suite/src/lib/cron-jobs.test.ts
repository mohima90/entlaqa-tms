import { afterEach, describe, expect, it, vi } from 'vitest';
import { cronAuthorized, handleCronJobsRequest } from './cron-jobs';

const SECRET = 'cron-secret-0123456789abcdef';

function call(authorization?: string) {
  return new Request('https://tms.example.com/api/cron/jobs', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cronAuthorized', () => {
  it('accepts exactly `Bearer <CRON_SECRET>`', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(cronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(cronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(cronAuthorized(SECRET, SECRET)).toBe(false);
    expect(cronAuthorized(null, SECRET)).toBe(false);
  });

  it('refuses everything without a CRON_SECRET of at least 16 characters (fail closed)', () => {
    expect(cronAuthorized('Bearer ', undefined)).toBe(false);
    expect(cronAuthorized('Bearer short', 'short')).toBe(false);
  });
});

describe('GET /api/cron/jobs', () => {
  it('401 without, or with a wrong, secret — and nothing is requested', async () => {
    const requestWorkerPass = vi.fn(() => Promise.resolve('dispatched'));
    const env = { CRON_SECRET: SECRET };
    for (const authorization of [
      undefined,
      'Bearer wrong',
      `Bearer ${SECRET}0`,
      `Basic ${SECRET}`,
    ]) {
      const response = await handleCronJobsRequest(call(authorization), {
        env,
        requestWorkerPass,
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(requestWorkerPass).not.toHaveBeenCalled();
  });

  it('401 when CRON_SECRET is not set on the server, warned once per instance', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const requestWorkerPass = vi.fn(() => Promise.resolve('dispatched'));
    for (const env of [{}, { CRON_SECRET: 'short' }, {}]) {
      const response = await handleCronJobsRequest(call('Bearer '), { env, requestWorkerPass });
      expect(response.status).toBe(401);
    }
    expect(requestWorkerPass).not.toHaveBeenCalled();
    const lines = spy.mock.calls.map(([line]) => String(line));
    expect(lines.filter((line) => line.includes('cron_secret_missing'))).toHaveLength(1);
  });

  it('200 with the secret: asks for a pass with reason `cron` and returns the outcome only', async () => {
    const requestWorkerPass = vi.fn(() => Promise.resolve('dispatched'));
    const response = await handleCronJobsRequest(call(`Bearer ${SECRET}`), {
      env: { CRON_SECRET: SECRET },
      requestWorkerPass,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'dispatched' });
    expect(requestWorkerPass).toHaveBeenCalledWith('cron');
  });

  it('200 no-op when dispatching is not configured (no JOBS_DISPATCH_TOKEN)', async () => {
    const response = await handleCronJobsRequest(call(`Bearer ${SECRET}`), {
      env: { CRON_SECRET: SECRET },
      requestWorkerPass: () => Promise.resolve('off'),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'off' });
  });
});
