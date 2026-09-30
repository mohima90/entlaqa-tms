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
