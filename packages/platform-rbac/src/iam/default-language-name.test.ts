import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultNameError,
  defaultNameField,
  nameInOneLanguage,
  shownNameClash,
} from './default-language-name';

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
    const stored = { thing: 'cost_centre', id: ID, version: 3 } as const;
    db.getStoredNames.mockResolvedValue({ nameEn: null, nameAr: 'المبيعات', version: 3 });
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
  });

  it('compares the stored names trimmed, as the typed ones arrive', async () => {
    const stored = { thing: 'unit', id: ID, version: 1 } as const;
    // A name stored with spaces around it (an import, an older row); a blank one counts as none.
    db.getStoredNames.mockResolvedValue({ nameEn: '   ', nameAr: '  المبيعات ', version: 1 });
    expect(await defaultNameError(TX, { nameEn: null, nameAr: 'المبيعات' }, stored)).toBeNull();
    expect(
      await defaultNameError(TX, { nameEn: null, nameAr: 'المبيعات 2' }, stored),
    ).toMatchObject({ fieldErrors: [{ path: 'nameEn', code: 'REQUIRED' }] });
  });

  it('leaves a thing that is gone or was changed meanwhile to the write (not found, conflict)', async () => {
    const stored = { thing: 'branch', id: ID, version: 3 } as const;
    const typed = { nameEn: null, nameAr: 'الرياض' };
    // Deleted meanwhile: the write answers NOT_FOUND.
    db.getStoredNames.mockResolvedValue(null);
    expect(await defaultNameError(TX, typed, stored)).toBeNull();
    // Renamed by someone else meanwhile: the write answers CONFLICT_VERSION, not «required».
    db.getStoredNames.mockResolvedValue({ nameEn: 'Riyadh', nameAr: 'الرياض', version: 4 });
    expect(await defaultNameError(TX, typed, stored)).toBeNull();
    // A version from the future is nobody's form: the rule answers, even with the names as stored.
    db.getStoredNames.mockResolvedValue({ nameEn: null, nameAr: 'الرياض', version: 2 });
    expect(await defaultNameError(TX, typed, stored)).toMatchObject({
      fieldErrors: [{ path: 'nameEn', code: 'REQUIRED' }],
    });
  });
});

describe('shownNameClash (WP-UX-01 c review, finding 3)', () => {
  const others = [
    { nameEn: 'Auditor', nameAr: null },
    { nameEn: null, nameAr: 'المالية' },
    { nameEn: 'Sales', nameAr: 'المبيعات' },
  ];

  it('compares what each thing shows in each language, case-insensitively and trimmed', () => {
    // Shown in Arabic as the first one shows «Auditor».
    expect(shownNameClash({ nameEn: 'Reviewer', nameAr: ' auditor ' }, others)).toBe('nameAr');
    // English only: shows «Auditor» in English and Arabic — taken in English already.
    expect(shownNameClash({ nameEn: 'AUDITOR', nameAr: null }, others)).toBe('nameEn');
    // English only, «المالية» shown in English by the second: the English name stands in.
    expect(shownNameClash({ nameEn: 'المالية', nameAr: null }, others)).toBe('nameEn');
    // Arabic only: the third shows «المبيعات» in Arabic.
    expect(shownNameClash({ nameEn: null, nameAr: 'المبيعات' }, others)).toBe('nameAr');
  });

  it('lets different shown names and the same name in another language through', () => {
    expect(shownNameClash({ nameEn: 'Finance', nameAr: 'مالية' }, others)).toBeNull();
    // «Sales» in Arabic slot while the third shows «المبيعات» in Arabic: different shown names.
    expect(shownNameClash({ nameEn: 'Marketing', nameAr: 'Sales' }, others)).toBeNull();
    expect(shownNameClash({ nameEn: null, nameAr: null }, others)).toBeNull();
    expect(shownNameClash({ nameEn: 'Auditor', nameAr: null }, [])).toBeNull();
  });
});
