import 'server-only';
import { isDatabaseConfigured } from '@jadarat/platform-db';
import { getSupabasePublicConfig } from '@jadarat/platform-db/supabase-server';

export interface ConfigStatus {
  readonly auth: boolean;
  readonly database: boolean;
}

/** Feature detection: the app builds and runs without Supabase and shows a "not configured" state. */
export function getConfigStatus(): ConfigStatus {
  return { auth: getSupabasePublicConfig() !== null, database: isDatabaseConfigured() };
}
