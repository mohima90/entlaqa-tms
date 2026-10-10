import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOWNLOAD_EXTENSIONS } from '../packages/platform-files/src/purposes.ts';

/**
 * Supabase Auth's e-mail templates (FR-IAM-13, T-M2-08; docs/engineering/password-reset.md). Since T-M2-17
 * our notification service sends these e-mails (PASSWORD_RESET_DELIVERY=worker); Auth's own mailer is the
 * fallback (`auth`, the default until the worker runs continuously): hosted Supabase's dashboard and local
 * Supabase (supabase/config.toml) still use these files. Auth renders them itself, so these checks guard
 * what must never change: the reset link goes straight to our page with the token hash in the URL
 * FRAGMENT, and no template carries the one-time code or Auth's own /verify link. The self-hosted stack
 * uses the worker only: its Auth has no mail relay and no templates.
 */
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const recovery = read('supabase/templates/recovery.html');
const changed = read('supabase/templates/password-changed.html');
/** The markup without HTML comments (a plain scan, not a regular-expression replace). */
const withoutComments = (html) => {
  let out = '';
  let at = 0;
  for (;;) {
    const start = html.indexOf('<!--', at);
    if (start === -1) return out + html.slice(at);
    out += html.slice(at, start);
    const end = html.indexOf('-->', start + 4);
    if (end === -1) return out;
    at = end + 3;
  }
};
const actions = (html) => [...html.matchAll(/\{\{-?\s*([^}]*?)\s*-?\}\}/g)].map((m) => m[1]);

describe('Auth e-mail templates (T-M2-08)', () => {
  it('the reset e-mail links to our reset page in both languages, token in the fragment only', () => {
    const links = [...recovery.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual([
      '{{ .SiteURL }}/ar/reset-password#token_hash={{ .TokenHash }}&amp;type=recovery',
      '{{ .SiteURL }}/en/reset-password#token_hash={{ .TokenHash }}&amp;type=recovery',
    ]);
  });

  it('use only the variables they need — never the code, the /verify link or caller data', () => {
    expect(new Set(actions(recovery))).toEqual(new Set(['.SiteURL', '.TokenHash', '.Email']));
    expect(new Set(actions(changed))).toEqual(new Set(['.SiteURL', '.Email']));
    for (const html of [recovery, changed]) {
      // The explanatory comment names the forbidden variables; Auth strips it, the markup may not use them.
      expect(withoutComments(html)).not.toMatch(
        /\.Token\b(?!Hash)|ConfirmationURL|\.Data|\.RedirectTo/,
      );
    }
  });

  it('are bilingual, Arabic first (right to left)', () => {
    for (const html of [recovery, changed]) {
      expect(html).toMatch(/<html lang="ar" dir="rtl">/);
      expect(html.indexOf('lang="ar"')).toBeLessThan(html.indexOf('lang="en"'));
    }
  });

  it('are wired for local Supabase; Auth\'s own "password changed" notice is off there (ours is sent)', () => {
    const config = read('supabase/config.toml');
    expect(config).toContain('content_path = "./supabase/templates/recovery.html"');
    expect(config).toContain('content_path = "./supabase/templates/password-changed.html"');
    expect(config).toMatch(/\[auth\.email\.notification\.password_changed\]\nenabled = false\n/);
    expect(config).toMatch(/otp_expiry = 3600/);
    // The token hash is sha224(e-mail + code): the code must have GoTrue's maximum length (review H).
    expect(config).toMatch(/^otp_length = 10$/m);
  });

  it('the self-hosted stack: tokens as before, but Auth sends nothing — the worker does (T-M2-17)', () => {
    const compose = read('infra/docker/compose.yaml');
    expect(compose).toContain("GOTRUE_MAILER_OTP_EXP: '3600'");
    expect(compose).toContain("GOTRUE_MAILER_OTP_LENGTH: '10'");
    expect(compose).toContain('GOTRUE_MAILER_URLPATHS_RECOVERY: /auth/v1/verify');
    expect(compose).toContain("GOTRUE_MAILER_NOTIFICATIONS_PASSWORD_CHANGED_ENABLED: 'false'");
    // No mail relay for Auth (its mailer is then a no-op) and no templates container.
    expect(compose).not.toMatch(
      /^\s+(GOTRUE_SMTP_(HOST|PORT|USER|PASS)|GOTRUE_MAILER_TEMPLATES_\w+):|^ {2}auth-templates:/m,
    );
    expect(compose).toContain('PASSWORD_RESET_DELIVERY: worker');
    // The gateway refuses Auth's public endpoints that would issue (and so replace) recovery tokens.
    const gateway = read('infra/docker/gateway/nginx.conf');
    for (const path of ['recover', 'otp', 'magiclink', 'resend']) {
      expect(gateway).toContain(`location ^~ /auth/v1/${path} { return 404; }`);
    }
  });

  it("the self-hosted stack: Auth's admin API only on the internal admin port, one call per network (T-M2-17 review)", () => {
    const gateway = read('infra/docker/gateway/nginx.conf');
    const compose = read('infra/docker/compose.yaml');
    // The published port (8443) serves no admin path, not even with a valid admin key.
    for (const path of ['admin', 'invite']) {
      expect(gateway).toContain(`location ^~ /auth/v1/${path} { return 404; }`);
    }
    // Port 8444: generate_link for the workers' subnet, user creation for admin-cli's, and Storage's
    // object calls for the workers' subnet (file tasks, T-M2-18) — nothing else.
    const admin = gateway.slice(
      gateway.indexOf('listen 8444 ssl;'),
      gateway.indexOf('listen 8100 ssl;'),
    );
    expect([...admin.matchAll(/proxy_pass (\S+);/g)].map((m) => m[1])).toEqual([
      'http://auth:9999/admin/generate_link',
      'http://auth:9999/admin/users',
      'http://storage:5000/object/',
    ]);
    expect(admin).toMatch(
      /location = \/auth\/v1\/admin\/generate_link \{\n\s+deny 10\.231\.0\.1;\n\s+allow 10\.231\.0\.0\/28;\n\s+deny all;\n\s+limit_except POST \{ deny all; \}/,
    );
    expect(admin).toMatch(
      /location = \/auth\/v1\/admin\/users \{\n\s+deny 10\.231\.0\.17;\n\s+allow 10\.231\.0\.16\/28;\n\s+deny all;\n\s+limit_except POST \{ deny all; \}/,
    );
    expect(admin).toMatch(
      /location \^~ \/storage\/v1\/object\/ \{\n\s+deny 10\.231\.0\.1;\n\s+allow 10\.231\.0\.0\/28;\n\s+deny all;\n\s+limit_except GET POST DELETE \{ deny all; \}/,
    );
    expect(admin).toContain('location / { return 404; }');
    // No method-override header reaches Auth or Storage from any admin location.
    for (const header of ['X-HTTP-Method-Override', 'X-HTTP-Method', 'X-Method-Override']) {
      expect(admin.split(`proxy_set_header ${header} "";`)).toHaveLength(4);
    }
    // The same subnets in compose; the admin port is never published; who sits on which network.
    expect(compose).toContain('- { subnet: 10.231.0.0/28, gateway: 10.231.0.1 }');
    expect(compose).toContain('- { subnet: 10.231.0.16/28, gateway: 10.231.0.17 }');
    expect(compose).not.toMatch(/^\s+- ['"]?[\d.:]*8444(:\d+)?['"]?\s*(#.*)?$/m);
    expect(compose).toContain('SUPABASE_URL: https://gateway:8444');
    expect(compose).toContain('AUTH_URL: https://gateway:8444/auth/v1');
    expect(
      [...compose.matchAll(/^ {4}networks: \[(.*\bauth-(?:admin|tools)\b.*)\]$/gm)].map(
        (m) => m[1],
      ),
    ).toEqual([
      'auth-internal, auth-admin, auth-tools, edge, errors-ui, storage-internal', // gateway
      'db-app, mail, auth-admin, scan', // workers
      'auth-tools', // admin-cli
    ]);
  });

  it('the self-hosted stack: Storage only through its signed-URL paths on the published port (T-M2-18)', () => {
    const gateway = read('infra/docker/gateway/nginx.conf');
    const compose = read('infra/docker/compose.yaml');
    const published = gateway.slice(
      gateway.indexOf('listen 8443 ssl;'),
      gateway.indexOf('listen 8445 ssl;'),
    );
    // Exactly two Storage routes, for USING signed URLs only (security review M2): the browser's upload
    // (PUT, and its CORS preflight) and download (GET). Creating them (POST) is not served here.
    expect([...published.matchAll(/proxy_pass (http:\/\/storage\S+);/g)].map((m) => m[1])).toEqual([
      'http://storage:5000/object/upload/sign/',
      'http://storage:5000/object/sign/',
    ]);
    expect(published).toMatch(
      /location \^~ \/storage\/v1\/object\/upload\/sign\/ \{\n\s+error_log \S+ crit;\n\s+limit_except PUT OPTIONS \{ deny all; \}/,
    );
    expect(published).toMatch(
      /location \^~ \/storage\/v1\/object\/sign\/ \{\n\s+error_log \S+ crit;\n\s+limit_except GET \{ deny all; \}/,
    );
    expect(published).not.toMatch(/limit_except[^{]*POST/);
    // Downloads only as the app makes the link: token, then a name with one of our types' extensions —
    // matched case-sensitively (Storage ignores `DOWNLOAD=`), only the extension's case is free.
    const rule = /if \(\$args (!~\*?) "(.*)"\) \{ return 403; \}/.exec(published);
    expect(rule?.[1]).toBe('!~');
    const shape = new RegExp((rule?.[2] ?? '').replace('(?i:', '(?:'));
    const ok = 'token=a.b-c_d&download=%D9%85%20x.csv';
    expect(shape.test(ok)).toBe(true);
    for (const refused of [
      'token=a.b&DOWNLOAD=x.csv',
      'Token=a.b&download=x.csv',
      'token=a.b&download=x.hta',
      'token=a.b&download=x.csv&download=y.js',
      'token=a.b',
      'download=x.csv&token=a.b',
    ]) {
      expect(shape.test(refused), refused).toBe(false);
    }
    // Its extensions are exactly platform-files' DOWNLOAD_EXTENSIONS.
    const alternatives = /\(\?i:([^)]*)\)\$$/.exec(rule?.[2] ?? '')?.[1] ?? '';
    const gatewayExtensions = alternatives
      .split('|')
      .flatMap((alt) => (alt === 'jpe?g' ? ['jpg', 'jpeg'] : [alt]))
      .map((ext) => `.${ext}`)
      .sort();
    expect(gatewayExtensions).toEqual([...DOWNLOAD_EXTENSIONS]);
    // Creating signed URLs: port 8445, the app's network alone, the two sign POSTs and nothing else.
    const signing = gateway.slice(
      gateway.indexOf('listen 8445 ssl;'),
      gateway.indexOf('listen 8444 ssl;'),
    );
    expect([...signing.matchAll(/proxy_pass (\S+);/g)].map((m) => m[1])).toEqual([
      'http://storage:5000/object/upload/sign/',
      'http://storage:5000/object/sign/',
    ]);
    expect(signing).toMatch(
      /\n\s+deny 10\.231\.0\.33;\n\s+allow 10\.231\.0\.32\/28;\n\s+deny all;\n/,
    );
    expect(signing.split('limit_except POST { deny all; }')).toHaveLength(3);
    expect(signing).toContain('location / { return 404; }');
    expect(signing).toContain('proxy_set_header X-Upsert "";');
    expect(signing).toContain('error_log /var/log/nginx/error.log crit;');
    // The app and the gateway share `edge` (fixed subnet) and nothing else, so 8445's source rule holds.
    expect(compose).toContain('- { subnet: 10.231.0.32/28, gateway: 10.231.0.33 }');
    expect(compose).toContain('STORAGE_INTERNAL_URL: https://gateway:8445');
    expect(compose).toMatch(/^ {4}networks: \[db-app, edge, errors\]$/m); // the app
    expect(compose).not.toContain('extra_hosts');
    expect([...compose.matchAll(/^ {4}networks: \[(.*\bedge\b.*)\]$/gm)].map((m) => m[1])).toEqual([
      'auth-internal, auth-admin, auth-tools, edge, errors-ui, storage-internal', // gateway
      'db-app, edge, errors', // app
    ]);
    expect(compose).not.toMatch(/^\s+- ['"]?[\d.:]*8445(:\d+)?['"]?\s*(#.*)?$/m);
    // clamd's scratch space (memory) is bounded.
    expect(compose).toContain("tmpfs: ['/tmp:size=2048m']");
    // Everything else of Storage is refused; uploads never replace an object; downloads never render.
    expect(published).toContain('location ^~ /storage/ { return 404; }');
    expect(published).toContain('proxy_set_header X-Upsert "";');
    expect(published).toContain(
      `add_header Content-Security-Policy "default-src 'none'; sandbox" always;`,
    );
    // nosniff on uploads, their CORS preflight and downloads.
    expect(published.split('add_header X-Content-Type-Options nosniff always;')).toHaveLength(4);
    // Storage and clamd sit on internal networks only; Storage logs no request lines (names in URLs).
    expect(compose).toContain('storage-internal: { internal: true }');
    expect(compose).toContain('db-storage: { internal: true }');
    expect(compose).toContain('scan: { internal: true }');
    expect(compose).toMatch(/^ {4}networks: \[db-storage, storage-internal\]$/m);
    expect(compose).toMatch(/^ {4}networks: \[scan\]$/m);
    expect(compose).toContain('LOG_LEVEL: error');
    expect(compose).toContain('sslmode=verify-full&sslrootcert=/certs/ca.crt');
  });
});
