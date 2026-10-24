import { describe, expect, it, vi } from 'vitest';

const ssr = vi.hoisted(() => ({
  captured: [] as { cookies: { setAll?: (...args: never[]) => Promise<void> | void } }[],
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: (typeof ssr.captured)[number]) => {
    ssr.captured.push(options);
    return { auth: {} };
  },
}));

const { KEEP_SIGNED_IN_COOKIE, KEPT_SESSION_COOKIE_SECONDS, createSupabaseServerClient } =
  await import('./server');

const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };
/** What @supabase/ssr hands to setAll: its default is 400 days. */
const session = {
  name: 'sb-session',
  value: 'tokens',
  options: { path: '/', httpOnly: true, maxAge: 400 * 24 * 3600 },
};
const removal = { name: 'sb-session', value: '', options: { path: '/', maxAge: 0 } };

async function written(
  request: { name: string; value: string }[],
  keptSession?: () => boolean,
  cookie: typeof session | typeof removal = session,
) {
  const writes: unknown[][] = [];
  createSupabaseServerClient(
    { getAll: () => request, setAll: (toSet) => void writes.push(toSet) },
    config,
    keptSession ? { keptSession } : {},
  );
  const options = ssr.captured.at(-1);
  await options?.cookies.setAll?.([cookie] as never, {} as never);
  return writes[0]?.[0] as { options: { maxAge?: number; expires?: Date } };
}

describe('the lifetime of the session cookies («Remember this browser» = «keep me signed in»)', () => {
  it('a browser that did not keep its session gets session cookies: they end with the browser', async () => {
    const cookie = await written([]);
    expect(cookie.options).not.toHaveProperty('maxAge');
    expect(cookie.options).not.toHaveProperty('expires');
    expect(cookie.options).toMatchObject({ httpOnly: true, path: '/' });
  });

  it('a browser with the keep marker gets persistent cookies for the longest kept session', async () => {
    const cookie = await written([{ name: KEEP_SIGNED_IN_COOKIE, value: '1' }]);
    expect(cookie.options.maxAge).toBe(KEPT_SESSION_COOKIE_SECONDS);
    expect(KEPT_SESSION_COOKIE_SECONDS).toBe(31 * 24 * 60 * 60);
  });

  it('only the marker with the value 1 counts', async () => {
    const cookie = await written([{ name: KEEP_SIGNED_IN_COOKIE, value: '0' }]);
    expect(cookie.options).not.toHaveProperty('maxAge');
    const other = await written([{ name: 'something-else', value: '1' }]);
    expect(other.options).not.toHaveProperty('maxAge');
  });

  it('a sign-in flow decides for its own request: the marker can only be set after Auth answered', async () => {
    const kept = await written([], () => true);
    expect(kept.options.maxAge).toBe(KEPT_SESSION_COOKIE_SECONDS);
    const notKept = await written([{ name: KEEP_SIGNED_IN_COOKIE, value: '1' }], () => false);
    expect(notKept.options).not.toHaveProperty('maxAge');
  });

  it('removals stay removals', async () => {
    const cookie = await written([{ name: KEEP_SIGNED_IN_COOKIE, value: '1' }], undefined, removal);
    expect(cookie.options.maxAge).toBe(0);
  });
});
