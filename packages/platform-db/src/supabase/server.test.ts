import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_COOKIE_OPTIONS,
  createSupabaseServerClient,
  createSupabaseStatelessClient,
  createSupabaseVerifierClient,
  forwardableUserAgent,
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

  it("forwards a browser's User-Agent only when it is printable ASCII of at most 512 characters", () => {
    expect(forwardableUserAgent(' Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0 ')).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0',
    );
    expect(forwardableUserAgent(null)).toBeNull();
    expect(forwardableUserAgent('')).toBeNull();
    expect(forwardableUserAgent('a'.repeat(513))).toBeNull();
    expect(forwardableUserAgent('Mozilla\r\nX-Injected: 1')).toBeNull();
    expect(forwardableUserAgent('متصفح')).toBeNull();
    const client = createSupabaseServerClient(
      cookies,
      { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' },
      { userAgent: 'Mozilla/5.0' },
    );
    expect(client?.auth).toBeDefined();
  });

  it('asks Storage at the internal origin when one is given (self-hosted), Auth at the Supabase URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: '/object/upload/sign/imports/k?token=t' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createSupabaseServerClient(
      cookies,
      { url: 'https://gateway:8443', publishableKey: 'self-hosted' },
      { storageOrigin: 'https://gateway:8445' },
    );
    const answer = await client?.storage.from('imports').createSignedUploadUrl('k');
    const target = fetchSpy.mock.calls[0]?.[0];
    expect(target instanceof Request ? target.url : target?.toString()).toBe(
      'https://gateway:8445/storage/v1/object/upload/sign/imports/k',
    );
    // The URL handed back stays on the configured (then public) origin.
    expect(answer?.data?.signedUrl).toBe(
      'https://gateway:8443/storage/v1/object/upload/sign/imports/k?token=t',
    );
  });

  it('keeps the forwarded headers when Storage has its own origin (T-M2-11 × T-M2-18)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: '/object/upload/sign/imports/k?token=t' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createSupabaseServerClient(
      cookies,
      { url: 'https://gateway:8443', publishableKey: 'self-hosted' },
      {
        storageOrigin: 'https://gateway:8445',
        userAgent: 'Mozilla/5.0',
        headers: { 'X-Jadarat-Client': 'visitor-key' },
      },
    );
    await client?.storage.from('imports').createSignedUploadUrl('k');
    const [target, init] = fetchSpy.mock.calls[0] ?? [];
    expect(target instanceof Request ? target.url : target?.toString()).toBe(
      'https://gateway:8445/storage/v1/object/upload/sign/imports/k',
    );
    const sent = new Headers(target instanceof Request ? target.headers : init?.headers);
    expect(sent.get('user-agent')).toBe('Mozilla/5.0');
    expect(sent.get('x-jadarat-client')).toBe('visitor-key');
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSupabaseVerifierClient', () => {
  it('returns null when Supabase is not configured, a cookie-less client otherwise', () => {
    expect(createSupabaseVerifierClient(null)).toBeNull();
    const client = createSupabaseVerifierClient({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
    });
    expect(client?.auth).toBeDefined();
  });
});

describe('createSupabaseStatelessClient (password recovery, T-M2-08)', () => {
  it('returns null when Supabase is not configured', () => {
    expect(createSupabaseStatelessClient(null)).toBeNull();
  });

  it('keeps its session in memory only and uses no PKCE code verifier', () => {
    const client = createSupabaseStatelessClient({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
    });
    const auth = client?.auth as unknown as {
      persistSession: boolean;
      autoRefreshToken: boolean;
      flowType: string;
    };
    expect(auth.persistSession).toBe(false);
    expect(auth.autoRefreshToken).toBe(false);
    expect(auth.flowType).toBe('implicit');
  });
});

describe('extra Auth headers (self-hosted client-IP forwarding, T-M2-11)', () => {
  const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };
  const authHeaders = (client: unknown) =>
    (client as { auth: { headers: Record<string, string> } }).auth.headers;

  it('sends the given headers with every Auth call of the client, and none by default', () => {
    const headers = { 'X-Jadarat-Client': '203.0.113.7' };
    expect(authHeaders(createSupabaseServerClient(cookies, config, { headers }))).toMatchObject(
      headers,
    );
    expect(authHeaders(createSupabaseStatelessClient(config, { headers }))).toMatchObject(headers);
    expect(authHeaders(createSupabaseServerClient(cookies, config))).not.toHaveProperty(
      'X-Jadarat-Client',
    );
    expect(authHeaders(createSupabaseStatelessClient(config))).not.toHaveProperty(
      'X-Jadarat-Client',
    );
  });
});
