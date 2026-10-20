import { routing } from '@jadarat/platform-i18n/routing';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import type { ReactNode } from 'react';
import { signInBrand, signInBrandIcons } from '../../lib/sign-in-brand';
import { BrandStyle } from '../branding/brand-style';

/**
 * The organization's look on every page before the suite (WP-ADM-02, FR-ADM-07; security review L11):
 * sign-up, forgot / reset password, invitation links and the sign-in code pages get the same colours and
 * browser-tab icon as its sign-in page — found the same way (the address's subdomain, else this device's
 * last organization; lib/sign-in-brand.ts). Used as the `layout.tsx` of those routes; the pages pass the
 * logo and picture to their frame themselves. The Jadarat look when there is none.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  return signInBrandIcons(locale);
}

export default async function AuthBrandLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const brand = hasLocale(routing.locales, locale) ? await signInBrand(locale) : null;
  return (
    <>
      <BrandStyle colors={brand?.colors ?? null} />
      {children}
    </>
  );
}

/** The header's name line on the sign-in code pages: the organization's logo, else the product's name. */
export async function AuthHeaderBrand({
  locale,
  productName,
}: {
  readonly locale: 'ar' | 'en';
  readonly productName: string;
}) {
  const brand = await signInBrand(locale);
  if (!brand?.logoSrc) return <span className="text-lg font-semibold">{productName}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the organization's published copy (same origin)
    <img
      src={brand.logoSrc}
      alt={brand.name}
      className="max-h-8 max-w-40 object-contain"
      data-testid="auth-header-logo"
    />
  );
}
