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
