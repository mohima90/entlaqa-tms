import { describe, expect, it, vi } from 'vitest';
import { toSignInBrand } from './sign-in-brand';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock('@jadarat/platform-db', () => ({
  isDatabaseConfigured: () => false,
  publicTenantBrand: vi.fn(),
}));

const LOGO = '3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d';

describe('the sign-in page look (WP-ADM-02)', () => {
  const brand = {
    nameAr: 'شركة الراية',
    nameEn: 'Al Raya',
    primaryColor: '#7A1F2B',
    secondaryColor: '#9B2C3A',
    useGradient: false,
    logoAssetId: LOGO,
    faviconAssetId: null,
    signInImageAssetId: 'not-an-id',
  };

  it('names in the page language, same-origin image links, colours as stored', () => {
    expect(toSignInBrand(brand, 'en')).toEqual({
      colors: { primaryColor: '#7A1F2B', secondaryColor: '#9B2C3A', useGradient: false },
      name: 'Al Raya',
      logoSrc: `/api/brand/${LOGO}`,
      imageSrc: null,
      faviconSrc: null,
    });
    expect(toSignInBrand(brand, 'ar').name).toBe('شركة الراية');
    expect(toSignInBrand({ ...brand, nameEn: null }, 'en').name).toBe('شركة الراية');
  });
});
