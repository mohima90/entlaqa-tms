import { readEnv } from '../env';

/** Public Supabase configuration (safe for the browser). Returns null when not configured. */
export interface SupabasePublicConfig {
  readonly url: string;
  readonly publishableKey: string;
}

export function readSupabasePublicConfig(
  env: Record<string, string | undefined>,
): SupabasePublicConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1'
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return { url, publishableKey };
}

/**
 * The Supabase URL and publishable key from the RUNTIME environment. Read dynamically on purpose: a
 * literal `process.env.NEXT_PUBLIC_*` would be inlined by Next.js at build time, so one container image
 * could not be configured per deployment (sovereign installs, ADR 0010; T-M1-D04). Only server code
 * uses these values (no browser Supabase client, ADR 0003 §4.4); Vercel passes them to functions at
 * runtime.
 */
export function readSupabasePublicConfigFromEnv(): SupabasePublicConfig | null {
  return readSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: readEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  });
}
