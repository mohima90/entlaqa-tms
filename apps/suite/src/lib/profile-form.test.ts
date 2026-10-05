import { describe, expect, it } from 'vitest';
import { composedLength, formStateFrom } from './profile-form';

const empty = {
  firstNameAr: null,
  fatherNameAr: null,
  grandfatherNameAr: null,
  familyNameAr: null,
  firstNameEn: null,
  fatherNameEn: null,
  grandfatherNameEn: null,
  familyNameEn: null,
  mobileE164: null,
  preferredLocale: 'ar' as const,
};

describe('formStateFrom', () => {
  it('puts a display name without parts into the first-name field and says so', () => {
    const state = formStateFrom({
      ...empty,
      displayNameAr: 'مدير المنشأة',
      displayNameEn: 'Tenant Admin',
    });
    expect(state.values).toMatchObject({
      firstNameAr: 'مدير المنشأة',
      firstNameEn: 'Tenant Admin',
    });
    expect(state.prefilled).toEqual({ ar: true, en: true });
    const noEnglish = formStateFrom({ ...empty, displayNameAr: 'م', displayNameEn: null });
    expect(noEnglish.values.firstNameEn).toBeNull();
    expect(noEnglish.prefilled.en).toBe(false);
  });

  it('does not prefill a name longer than one field allows', () => {
    const state = formStateFrom({ ...empty, displayNameAr: 'م'.repeat(61), displayNameEn: null });
    expect(state.values.firstNameAr).toBeNull();
    expect(state.prefilled.ar).toBe(false);
  });

  it('keeps the parts when there are any', () => {
    const state = formStateFrom({
      ...empty,
      firstNameAr: 'سارة',
      familyNameAr: 'القحطاني',
      familyNameEn: 'Alqahtani',
      displayNameAr: 'سارة القحطاني',
      displayNameEn: 'Alqahtani',
    });
    expect(state.values).toMatchObject({
      firstNameAr: 'سارة',
      firstNameEn: null,
      familyNameEn: 'Alqahtani',
    });
    expect(state.prefilled).toEqual({ ar: false, en: false });
    expect(state.values).not.toHaveProperty('displayNameAr');
  });
});

describe('composedLength', () => {
  it('measures the joined, trimmed, non-empty parts', () => {
    expect(composedLength([' سارة ', '', 'القحطاني'])).toBe('سارة القحطاني'.length);
    expect(composedLength(['', ''])).toBe(0);
  });
});
