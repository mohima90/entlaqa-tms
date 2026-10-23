import { type SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { claimSignInCodeRequest } from './sign-in-codes';

const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';

function fakeTx(row: Record<string, unknown> | null) {
  return {
    execute: (_query: SQL) => Promise.resolve(row ? [row] : []),
  } as never;
}

const send = (over: Record<string, unknown> = {}) => ({
  id: ID,
  mode: 'code',
  outcome: 'send',
  email: 'sara@example.test',
  user_id: '00000000-0000-4000-8000-0000000000a1',
  tenant_id: 'a0000000-0000-4000-8000-000000000001',
  person_id: 'a1000000-0000-4000-8000-0000000000a1',
  locale: 'en',
  attempts: 1,
  platform_sender: false,
  ...over,
});

describe('the worker side of the sign-in codes', () => {
  it('leases a request and says whose sender may carry the code', async () => {
    expect(await claimSignInCodeRequest(fakeTx(send()))).toMatchObject({
      outcome: 'send',
      platformSender: false,
      locale: 'en',
    });
    expect(await claimSignInCodeRequest(fakeTx(send({ platform_sender: true })))).toMatchObject({
      platformSender: true,
    });
  });

  it('an answer without the flag (an older database) is the safe one: the platform sender', async () => {
    expect(await claimSignInCodeRequest(fakeTx(send({ platform_sender: null })))).toMatchObject({
      platformSender: true,
    });
  });

  it('nothing waiting, a skipped request and an unknown outcome', async () => {
    expect(await claimSignInCodeRequest(fakeTx(null))).toBeNull();
    expect(
      await claimSignInCodeRequest(
        fakeTx({ id: ID, mode: 'code', outcome: 'unknown_account', attempts: 2 }),
      ),
    ).toEqual({ id: ID, mode: 'code', outcome: 'unknown_account', attempt: 2 });
    await expect(
      claimSignInCodeRequest(fakeTx({ id: ID, mode: 'code', outcome: 'mystery', attempts: 1 })),
    ).rejects.toThrow('unknown outcome');
  });
});
