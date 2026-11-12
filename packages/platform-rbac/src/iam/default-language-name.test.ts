import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultNameError, defaultNameField, nameInOneLanguage } from './default-language-name';

const db = vi.hoisted(() => ({
  getTenantDefaultLocale: vi.fn((): Promise<'ar' | 'en'> => Promise.resolve('en')),
  getStoredNames: vi.fn((): Promise<unknown> => Promise.resolve(null)),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  db.getTenantDefaultLocale.mockResolvedValue('en');
  db.getStoredNames.mockResolvedValue(null);
});

describe('the name in the organization’s default language (WP-UX-01 b; PO, 12 Nov 2026)', () => {
  it('one name of the pair may be empty; a given name is trimmed, visible and within its length', () => {
    const name = nameInOneLanguage(5);
    expect(name.parse('  ')).toBeNull();
    expect(name.parse(' Team ')).toBe('Team');
    expect(name.safeParse('Longer').success).toBe(false);
    expect(name.safeParse(String.fromCodePoint(8203)).success).toBe(false);
  });

  it('requires the English name with English as the default language, the Arabic one with Arabic', async () => {
    expect(defaultNameField('en')).toBe('nameEn');
    expect(defaultNameField('ar')).toBe('nameAr');
    expect(await defaultNameError(TX, { nameEn: 'Sales', nameAr: null })).toBeNull();
    expect(await defaultNameError(TX, { nameEn: null, nameAr: 'المبيعات' })).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ path: 'nameEn', code: 'REQUIRED' }],
    });
    db.getTenantDefaultLocale.mockResolvedValue('ar');
    expect(await defaultNameError(TX, { nameEn: null, nameAr: 'المبيعات' })).toBeNull();
    expect(await defaultNameError(TX, { nameEn: 'Sales', nameAr: null })).toMatchObject({
      fieldErrors: [{ path: 'nameAr', code: 'REQUIRED' }],
    });
    // Creating never reads stored names.
    expect(db.getStoredNames).not.toHaveBeenCalled();
  });

  it('lets a save keep the names as they are stored, and applies the rule once they change', async () => {
    const stored = { thing: 'cost_centre', id: ID } as const;
    db.getStoredNames.mockResolvedValue({ nameEn: null, nameAr: 'المبيعات' });
    // E.g. «Deactivate» on a cost centre named in Arabic only, in an English-default organization.
    expect(await defaultNameError(TX, { nameEn: null, nameAr: 'المبيعات' }, stored)).toBeNull();
    expect(db.getStoredNames).toHaveBeenCalledWith(TX, 'cost_centre', ID);
    expect(
      await defaultNameError(TX, { nameEn: null, nameAr: 'مبيعات الرياض' }, stored),
    ).toMatchObject({ fieldErrors: [{ path: 'nameEn', code: 'REQUIRED' }] });
    // The stored names are not read when the rule is satisfied.
    db.getStoredNames.mockClear();
    expect(await defaultNameError(TX, { nameEn: 'Sales', nameAr: null }, stored)).toBeNull();
    expect(db.getStoredNames).not.toHaveBeenCalled();
    // The thing is gone: the rule answers.
    db.getStoredNames.mockResolvedValue(null);
    expect(await defaultNameError(TX, { nameEn: null, nameAr: 'المبيعات' }, stored)).not.toBeNull();
  });
});
