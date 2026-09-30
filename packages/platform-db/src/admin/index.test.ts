import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertAdminOperation, createServiceRoleSupabaseClient, withAdminTx } from './index';

const op = { reason: 'Provision tenant for signed contract', actor: 'job:tenant-provisioning' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('admin entry point', () => {
  it('requires a meaningful reason and an actor for every operation', () => {
    expect(() => {
      assertAdminOperation({ reason: 'x', actor: 'a' });
    }).toThrow('meaningful reason');
    expect(() => {
      assertAdminOperation({ reason: 'long enough reason', actor: ' ' });
    }).toThrow('actor');
    expect(() => {
      assertAdminOperation(op);
    }).not.toThrow();
  });

  it('fails closed when admin database access is not configured', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    await expect(withAdminTx(op, () => Promise.resolve(1))).rejects.toThrow('not configured');
  });

  it('fails closed when the Supabase secret key is not configured', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    expect(() => createServiceRoleSupabaseClient(op)).toThrow('not configured');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test');
    expect(createServiceRoleSupabaseClient(op).auth).toBeDefined();
  });
});
