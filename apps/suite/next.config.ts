import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import {
  SECRET_URL_PAGES,
  STATIC_FALLBACK_CSP,
  secretUrlHeaders,
  staticSecurityHeaders,
} from './src/lib/security-headers';

const monorepoRoot = path.join(import.meta.dirname, '../..');

const nextConfig: NextConfig = {
  // Same build runs on Vercel and in containers (sovereign deployments, ADR 0001 / ADR 0010).
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  poweredByHeader: false,
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (no separate build step).
  transpilePackages: [
    '@jadarat/platform-core',
    '@jadarat/platform-db',
    '@jadarat/platform-i18n',
    '@jadarat/platform-observability',
    '@jadarat/tms',
    '@jadarat/ui',
  ],
  // Browsers ask for /favicon.ico by default; the app icon is app/icon.svg.
  redirects() {
    return Promise.resolve([{ source: '/favicon.ico', destination: '/icon.svg', permanent: true }]);
  },
  headers() {
    // Static security headers for every response; the nonce-based CSP is set per request in src/proxy.ts
    // for every path the proxy matches. Build assets (/_next/static) bypass the proxy and get a strict
    // static CSP instead, so no response is served without one.
    return Promise.resolve([
      { source: '/:path*', headers: [...staticSecurityHeaders] },
      // Invitation links carry a token in the query string: no referrer (overrides the entry above).
      { source: SECRET_URL_PAGES, headers: [...secretUrlHeaders] },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Content-Security-Policy', value: STATIC_FALLBACK_CSP }],
      },
    ]);
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
