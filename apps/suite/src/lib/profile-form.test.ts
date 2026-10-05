import { describe, expect, it } from 'vitest';
import { formValuesFrom } from './profile-form';

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

describe('formValuesFrom', () => {
  it('puts a display name without parts into the first-name field (nothing lost on save)', () => {
    expect(
      formValuesFrom({ ...empty, displayNameAr: 'مدير المنشأة', displayNameEn: 'Tenant Admin' }),
    ).toMatchObject({ firstNameAr: 'مدير المنشأة', firstNameEn: 'Tenant Admin' });
    expect(
      formValuesFrom({ ...empty, displayNameAr: 'م', displayNameEn: null }).firstNameEn,
    ).toBeNull();
  });

  it('keeps the parts when there are any', () => {
    const values = formValuesFrom({
      ...empty,
      firstNameAr: 'سارة',
      familyNameAr: 'القحطاني',
      familyNameEn: 'Alqahtani',
      displayNameAr: 'سارة القحطاني',
      displayNameEn: 'Alqahtani',
    });
    expect(values).toMatchObject({
      firstNameAr: 'سارة',
      firstNameEn: null,
      familyNameEn: 'Alqahtani',
    });
    expect(values).not.toHaveProperty('displayNameAr');
  });
});
