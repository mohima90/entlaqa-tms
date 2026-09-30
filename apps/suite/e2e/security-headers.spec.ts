import { expect, test } from '@playwright/test';

/**
 * Request-proxy guarantees against the production standalone server (security review L3):
 * client-supplied internal headers never reach the app, and every response class carries a CSP —
 * the per-request nonce CSP from the proxy, or the strict static fallback for /_next/static.
 */
const hostile = {
  'x-jadarat-host-kind': 'custom',
  'x-jadarat-host-ref': 'evil.example',
  'x-nonce': 'attacker-nonce',
};

test.describe('request proxy (security headers)', () => {
  test('client-supplied x-jadarat-* / x-nonce headers never reach server components', async ({
    browser,
  }) => {
    const context = await browser.newContext({ extraHTTPHeaders: hostile });
    const page = await context.newPage();
    const response = await page.goto('/en/suite');
    expect(response?.status()).toBe(200);
    const tenant = page.getByTestId('tenant-context');
    await expect(tenant).toHaveAttribute('data-host-kind', 'platform');
    await expect(tenant).not.toContainText('evil.example');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/'nonce-[^']+'/);
    expect(csp).not.toContain('attacker-nonce');
    // The rendered scripts carry the proxy's nonce, not the client's.
    const nonces = await page
      .locator('script[nonce]')
      .evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).nonce));
    expect(nonces.length).toBeGreaterThan(0);
    expect(nonces).not.toContain('attacker-nonce');
    await context.close();
  });

  test('a malformed (undecodable) page path is still handled by the proxy', async ({ request }) => {
    const response = await request.get('/ar/%E0%A4%A', { headers: hostile });
    const csp = response.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toContain('attacker-nonce');
  });

  for (const path of ['/api/health-does-not-exist', '/icon.svg']) {
    test(`${path} passes the proxy (nonce CSP, no locale redirect)`, async ({ request }) => {
      const response = await request.get(path, { headers: hostile, maxRedirects: 0 });
      expect(response.status()).not.toBe(307);
      const headers = response.headers();
      expect(headers['content-security-policy']).toMatch(/'nonce-[^']+'/);
      expect(headers['content-security-policy']).not.toContain('attacker-nonce');
      expect(headers['x-content-type-options']).toBe('nosniff');
    });
  }

  test('build assets (/_next/static) get the strict static fallback CSP', async ({
    page,
    request,
  }) => {
    await page.goto('/ar');
    const asset = await page.locator('script[src*="/_next/static/"]').first().getAttribute('src');
    expect(asset).toBeTruthy();
    const response = await request.get(asset ?? '');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['strict-transport-security']).not.toContain('preload');
  });
});
