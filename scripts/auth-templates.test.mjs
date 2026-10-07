import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
      /^\s+(GOTRUE_SMTP_(HOST|PORT|USER|PASS)|GOTRUE_MAILER_TEMPLATES_\w+):|^  auth-templates:/m,
    );
    expect(compose).toContain('PASSWORD_RESET_DELIVERY: worker');
    // The gateway refuses Auth's public endpoints that would issue (and so replace) recovery tokens.
    const gateway = read('infra/docker/gateway/nginx.conf');
    for (const path of ['recover', 'otp', 'magiclink', 'resend']) {
      expect(gateway).toContain(`location ^~ /auth/v1/${path} { return 404; }`);
    }
  });
});
