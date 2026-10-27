import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/brand-css (WP-FIX-02 #1)', () => {
  it('answers the colours of a URL we write as an immutable stylesheet', async () => {
    const response = GET(new Request('https://app.test/api/brand-css?p=7A1F2B&s=9B2C3A&g=1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const css = await response.text();
    expect(css).toContain('html:root {');
    expect(css).toContain('--color-brand: #7A1F2B;');
  });

  it('is 404 for the Jadarat look and for anything that is not our URL', () => {
    for (const query of ['', 'g=1', 'p=2F4858&s=33658A&g=1', 'p=red&g=1', 'p=7A1F2B&g=yes']) {
      expect(GET(new Request(`https://app.test/api/brand-css?${query}`)).status).toBe(404);
    }
  });
});
