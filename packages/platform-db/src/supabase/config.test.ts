import { describe, expect, it } from 'vitest';
import { readSupabasePublicConfig } from './config';

describe('readSupabasePublicConfig', () => {
  it('returns null when not configured (app must run without Supabase)', () => {
    expect(readSupabasePublicConfig({})).toBeNull();
    expect(
      readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }),
    ).toBeNull();
  });

  it('accepts https URLs and local development URLs only', () => {
    const key = { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
    expect(
      readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', ...key }),
    ).toEqual({ url: 'https://x.supabase.co', publishableKey: 'sb_publishable_test' });
    expect(
      readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', ...key }),
    ).not.toBeNull();
    expect(
      readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: 'http://evil.example', ...key }),
    ).toBeNull();
    expect(readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: 'not a url', ...key })).toBeNull();
  });
});
