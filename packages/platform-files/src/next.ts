/**
 * Next.js adapter: Supabase Storage with the signed-in user's session cookies (publishable key; no Storage
 * key in the web app, ADR 0006 §3), reached at STORAGE_INTERNAL_URL when set (self-hosted: the gateway's
 * internal port, the only one that creates signed URLs). For defineAction's `afterCommit` — signUploadIntent
 * and signDownload refuse to run inside a transaction (T-M2-18 integration review M1).
 */
import 'server-only';
import {
  type UserFileStorage,
  createSupabaseServerClient,
  createUserFileStorage,
  readStorageInternalOrigin,
} from '@jadarat/platform-db/supabase-server';
import { cookies, headers } from 'next/headers';

export async function requestFileStorage(): Promise<UserFileStorage> {
  const store = await cookies();
  // Should this client refresh the session, Auth records the browser's User-Agent, as everywhere else
  // (session lists, T-M2-10; platform-identity next.ts).
  const userAgent = (await headers()).get('user-agent');
  const supabase = createSupabaseServerClient(
    {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; the proxy refreshes them.
        }
      },
    },
    undefined,
    { storageOrigin: readStorageInternalOrigin(), userAgent },
  );
  if (!supabase) throw new Error('Supabase is not configured');
  return createUserFileStorage(supabase);
}
