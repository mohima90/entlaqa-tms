import { appError, ok } from '@jadarat/platform-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DEFINE_PUBLIC_ACTION_MARKER, createDefinePublicAction } from './define-public-action';

function setup() {
  const logError = vi.fn();
  const definePublicAction = createDefinePublicAction({ logError });
  return { logError, definePublicAction };
}

const input = z.object({ email: z.email() });

describe('definePublicAction', () => {
  it('validates input before the handler runs', async () => {
    const { definePublicAction } = setup();
    const handler = vi.fn();
    const action = definePublicAction({ name: 'platform.auth.sign_in', input, handler });
    const result = await action({ email: 'not-an-email' });
    expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes validated input and returns the handler result; marks the action', async () => {
    const { definePublicAction } = setup();
    const action = definePublicAction({
      name: 'platform.auth.sign_in',
      input,
      handler: ({ input: value }) => Promise.resolve(ok({ seen: value.email })),
    });
    expect(await action({ email: 'a@b.test' })).toEqual({ ok: true, value: { seen: 'a@b.test' } });
    expect((action as unknown as Record<symbol, string>)[DEFINE_PUBLIC_ACTION_MARKER]).toBe(
      'platform.auth.sign_in',
    );
  });

  it('returns exposed handler errors as-is and hides internal ones', async () => {
    const { definePublicAction } = setup();
    const unauth = definePublicAction({
      name: 'x.y.z',
      input,
      handler: () => Promise.resolve({ ok: false, error: appError('UNAUTHENTICATED') }),
    });
    const result = await unauth({ email: 'a@b.test' });
    expect(!result.ok && result.error.code).toBe('UNAUTHENTICATED');

    // A non-exposed error with its own code must not reach the client: it becomes INTERNAL_ERROR.
    const internal = definePublicAction({
      name: 'x.y.z',
      input,
      handler: () =>
        Promise.resolve({
          ok: false,
          error: { ...appError('INTERNAL_ERROR'), code: 'DB_POOL_EXHAUSTED', expose: false },
        }),
    });
    const hidden = await internal({ email: 'a@b.test' });
    expect(!hidden.ok && hidden.error.code).toBe('INTERNAL_ERROR');
  });

  it('turns unexpected exceptions into INTERNAL_ERROR with a correlation id, logging no input', async () => {
    const { definePublicAction, logError } = setup();
    const action = definePublicAction({
      name: 'platform.auth.sign_in',
      input,
      handler: () => Promise.reject(new TypeError('boom secret@x.test')),
    });
    const result = await action({ email: 'a@b.test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.correlationId).toMatch(/.+/);
      expect(logError).toHaveBeenCalledWith(expect.any(TypeError), {
        action: 'platform.auth.sign_in',
        correlationId: result.error.correlationId,
      });
    }
  });

  it('lets Next.js redirect/notFound signals propagate', async () => {
    const { definePublicAction } = setup();
    const signal = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/ar',
    });
    const action = definePublicAction({
      name: 'x.y.z',
      input,
      handler: () => Promise.reject(signal),
    });
    await expect(action({ email: 'a@b.test' })).rejects.toBe(signal);
    const notSignal = definePublicAction({
      name: 'x.y.z',
      input,
      handler: () => Promise.reject(Object.assign(new Error('x'), { digest: 42 })),
    });
    const result = await notSignal({ email: 'a@b.test' });
    expect(result.ok).toBe(false);
  });
});
