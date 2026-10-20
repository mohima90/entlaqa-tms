import 'server-only';
import {
  type PublicTenantBrand,
  isDatabaseConfigured,
  publicTenantBrand,
} from '@jadarat/platform-db';
import type { AppLocale } from '@jadarat/platform-i18n';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { brandAssetPath } from './branding-view';
import { HOST_KIND_HEADER, HOST_REF_HEADER } from './host-tenant';
import { BRAND_COOKIE, signInBrandSlug } from './sign-in-brand-cookie';

/** The sign-in page's organization look (WP-ADM-02): colours, logo, picture, favicon — or none. */
export interface SignInBrand {
  readonly colors: {
    readonly primaryColor: string | null;
    readonly secondaryColor: string | null;
    readonly useGradient: boolean;
  };
  /** The organization's name in the page language (the logo's text alternative). */
  readonly name: string;
  readonly logoSrc: string | null;
  readonly imageSrc: string | null;
  readonly faviconSrc: string | null;
}

/** Pure: the public look → what the sign-in page shows. */
export function toSignInBrand(brand: PublicTenantBrand, locale: AppLocale): SignInBrand {
  return {
    colors: {
      primaryColor: brand.primaryColor,
      secondaryColor: brand.secondaryColor,
      useGradient: brand.useGradient,
    },
    name: locale === 'en' ? (brand.nameEn ?? brand.nameAr) : brand.nameAr,
    logoSrc: brandAssetPath(brand.logoAssetId),
    imageSrc: brandAssetPath(brand.signInImageAssetId),
    faviconSrc: brandAssetPath(brand.faviconAssetId),
  };
}

/**
 * The organization whose sign-in page this is — by the address (subdomain), else this device's last one —
 * and its public look; null for the Jadarat look. Read once per request (page and metadata). A failure to
 * read it never stops anyone signing in: the Jadarat look.
 */
export const signInBrand = cache(async (locale: AppLocale): Promise<SignInBrand | null> => {
  if (!isDatabaseConfigured('app_server')) return null;
  const requestHeaders = await headers();
  const slug = signInBrandSlug(
    requestHeaders.get(HOST_KIND_HEADER),
    requestHeaders.get(HOST_REF_HEADER),
    (await cookies()).get(BRAND_COOKIE)?.value,
  );
  if (!slug) return null;
  try {
    const brand = await publicTenantBrand(slug);
    return brand ? toSignInBrand(brand, locale) : null;
  } catch {
    return null;
  }
});

/** The auth frame's part of the look (logo, name, picture), or null for Jadarat's. */
export function authBrandOf(brand: SignInBrand | null): {
  readonly logoSrc: string | null;
  readonly name: string;
  readonly imageSrc: string | null;
} | null {
  return brand ? { logoSrc: brand.logoSrc, name: brand.name, imageSrc: brand.imageSrc } : null;
}

/** The browser-tab icon of a look as page metadata; nothing (the Jadarat icon) without one. */
export function brandIcons(brand: SignInBrand | null): Metadata {
  return brand?.faviconSrc
    ? { icons: { icon: [{ url: brand.faviconSrc }], shortcut: [{ url: brand.faviconSrc }] } }
    : {};
}

/**
 * The organization's browser-tab icon on every page before the suite (sign-in, sign-up, forgot / reset
 * password, invitations, the sign-in code; security review L11) — found as the sign-in page finds its look.
 */
export async function signInBrandIcons(locale: AppLocale): Promise<Metadata> {
  return brandIcons(await signInBrand(locale));
}
