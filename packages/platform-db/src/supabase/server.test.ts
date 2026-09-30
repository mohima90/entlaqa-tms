import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_OPTIONS,
  createSupabaseServerClient,
  getSupabasePublicConfig,
} from './server';

const cookies = { getAll: () => [], setAll: () => undefined };

describe('createSupabaseServerClient', () => {
  it('returns null when Supabase is not configured', () => {
    expect(createSupabaseServerClient(cookies, null)).toBeNull();
  });

  it('creates a client when configured', () => {
    const client = createSupabaseServerClient(cookies, {
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
    });
    expect(client?.auth).toBeDefined();
  });

  it('reads public config from the environment', () => {
    expect(getSupabasePublicConfig()).toBeNull();
  });

  it('uses HttpOnly, SameSite=Lax, host-only session cookies (ADR 0003 §2)', () => {
    expect(SESSION_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(SESSION_COOKIE_OPTIONS.sameSite).toBe('lax');
    expect(SESSION_COOKIE_OPTIONS.secure).toBe(true);
    expect(SESSION_COOKIE_OPTIONS).not.toHaveProperty('domain');
  });
});
