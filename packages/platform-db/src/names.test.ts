import { describe, expect, it } from 'vitest';
import { type NameFields, keepUnsplitDisplayNames } from './names';

const empty: NameFields = {
  firstNameAr: null,
  fatherNameAr: null,
  grandfatherNameAr: null,
  familyNameAr: null,
  firstNameEn: null,
  fatherNameEn: null,
  grandfatherNameEn: null,
  familyNameEn: null,
  displayNameAr: '',
  displayNameEn: null,
};
const longEn = 'A'.repeat(61);
const longAr = 'س'.repeat(61);

describe('keepUnsplitDisplayNames', () => {
  it('keeps a long display name stored without parts when no parts are sent', () => {
    const before = { ...empty, displayNameAr: longAr, displayNameEn: longEn };
    expect(keepUnsplitDisplayNames(before, empty)).toEqual(before);
  });

  it('a short one (pre-filled by the form) or one with parts follows the sent parts', () => {
    expect(keepUnsplitDisplayNames({ ...empty, displayNameEn: 'Sarah' }, empty).displayNameEn).toBe(
      null,
    );
    const withParts = { ...empty, firstNameEn: 'A', displayNameEn: longEn };
    expect(keepUnsplitDisplayNames(withParts, empty).displayNameEn).toBe(null);
    const sent = { ...empty, firstNameEn: 'Sarah', displayNameEn: 'Sarah' };
    expect(keepUnsplitDisplayNames({ ...empty, displayNameEn: longEn }, sent).displayNameEn).toBe(
      'Sarah',
    );
  });
});
