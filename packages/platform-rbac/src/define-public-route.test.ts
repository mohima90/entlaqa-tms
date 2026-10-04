import { describe, expect, it, vi } from 'vitest';
import { DEFINE_PUBLIC_ROUTE_MARKER, createDefinePublicRoute } from './define-public-route';

function setup() {
  const logError = vi.fn();
  return { logError, definePublicRoute: createDefinePublicRoute({ logError }) };
}

describe('definePublicRoute', () => {
  it('runs the handler and marks the route', async () => {
    const { definePublicRoute } = setup();
    const route = definePublicRoute({
      name: 'platform.test.ping',
      handler: () => Promise.resolve(new Response(null, { status: 202 })),
    });
    expect((await route(new Request('https://app/x', { method: 'POST' }))).status).toBe(202);
    expect((route as unknown as Record<symbol, string>)[DEFINE_PUBLIC_ROUTE_MARKER]).toBe(
      'platform.test.ping',
    );
  });

  it('turns unexpected errors into a 500 problem with a reference id, logged without details', async () => {
    const { definePublicRoute, logError } = setup();
    const route = definePublicRoute({
      name: 'platform.test.crash',
      handler: () => Promise.reject(new Error('secret a@b.co')),
    });
    const response = await route(new Request('https://app/x', { method: 'POST' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(logError).toHaveBeenCalledWith(expect.any(Error), {
      action: 'platform.test.crash',
      correlationId: body.correlationId,
    });
  });

  it('lets Next.js control-flow signals through', async () => {
    const { definePublicRoute } = setup();
    const signal = Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;x' });
    const route = definePublicRoute({ name: 'x', handler: () => Promise.reject(signal) });
    await expect(route(new Request('https://app/x', { method: 'POST' }))).rejects.toBe(signal);
    const plain = definePublicRoute({
      name: 'x',
      handler: () => Promise.reject(Object.assign(new Error('x'), { digest: 42 })),
    });
    expect((await plain(new Request('https://app/x', { method: 'POST' }))).status).toBe(500);
  });
});
