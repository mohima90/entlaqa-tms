import { describe, expect, it } from 'vitest';
import {
  missingNameFields,
  otherNameLanguage,
  personDisplayName,
  personDisplayNameLanguage,
  requiredNameFields,
} from './names';

describe('names (guided-test feedback #2: the required name follows the default language)', () => {
  it('requires the default language’s first and family names', () => {
    expect(requiredNameFields('en')).toEqual(['firstNameEn', 'familyNameEn']);
    expect(requiredNameFields('ar')).toEqual(['firstNameAr', 'familyNameAr']);
    expect(otherNameLanguage('en')).toBe('ar');
    expect(otherNameLanguage('ar')).toBe('en');
  });

  it('English default: English names required, Arabic optional', () => {
    expect(missingNameFields('en', { firstNameEn: 'Sara', familyNameEn: 'Ali' })).toEqual([]);
    expect(missingNameFields('en', { firstNameAr: 'سارة', familyNameAr: 'علي' })).toEqual([
      'firstNameEn',
      'familyNameEn',
    ]);
    expect(missingNameFields('en', { firstNameEn: '  ', familyNameEn: 'Ali' })).toEqual([
      'firstNameEn',
    ]);
    expect(missingNameFields('en', { firstNameEn: 'Sara', familyNameEn: null })).toEqual([
      'familyNameEn',
    ]);
  });

  it('Arabic default: Arabic names required, English optional', () => {
    expect(missingNameFields('ar', { firstNameAr: 'سارة', familyNameAr: 'علي' })).toEqual([]);
    expect(missingNameFields('ar', { firstNameEn: 'Sara', familyNameEn: 'Ali' })).toEqual([
      'firstNameAr',
      'familyNameAr',
    ]);
  });

  it('shows the page language’s name, else the other one', () => {
    expect(personDisplayName('en', 'سارة علي', 'Sara Ali')).toBe('Sara Ali');
    expect(personDisplayName('ar', 'سارة علي', 'Sara Ali')).toBe('سارة علي');
    expect(personDisplayName('ar', null, 'Sara Ali')).toBe('Sara Ali');
    expect(personDisplayName('en', 'سارة علي', null)).toBe('سارة علي');
    expect(personDisplayName('en', 'سارة علي', ' ')).toBe('سارة علي');
    expect(personDisplayName('ar', null, null)).toBe('');
    expect(personDisplayNameLanguage('ar', null, 'Sara Ali')).toBe('en');
    expect(personDisplayNameLanguage('en', 'سارة', null)).toBe('ar');
    expect(personDisplayNameLanguage('en', 'سارة', 'Sara')).toBe('en');
    expect(personDisplayNameLanguage('ar', 'سارة', 'Sara')).toBe('ar');
    expect(personDisplayNameLanguage('ar', null, undefined)).toBeNull();
  });
});
