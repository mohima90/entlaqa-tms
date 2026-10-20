'use client';

import { preferenceCookie } from '@jadarat/ui';
import { useEffect } from 'react';
import { BRAND_COOKIE } from '../../lib/sign-in-brand-cookie';

/**
 * Remembers on this device which organization's look the sign-in page shows next time (WP-ADM-02; Kawadir
 * shows the organization's sign-in page on its own address — here also on the shared address, after a first
 * visit). Display only: the organization's slug, never used for anything but its public look.
 */
export function RememberBrand({ slug }: { readonly slug: string }) {
  useEffect(() => {
    document.cookie = preferenceCookie(BRAND_COOKIE, slug, window.location.protocol === 'https:');
  }, [slug]);
  return null;
}
