import { describe, expect, it } from 'vitest';
import { personPhotoHref } from './person-photo';

const PERSON = '3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d';

describe('personPhotoHref (WP-ADM-04)', () => {
  it('is the same-origin route with the photo’s version', () => {
    expect(personPhotoHref(PERSON, 'abcdef012345')).toBe(`/api/photo/${PERSON}?v=abcdef012345`);
  });

  it('is nothing without a photo (initials show) or for anything that is not a person id and a version', () => {
    expect(personPhotoHref(PERSON, null)).toBeNull();
    expect(personPhotoHref(PERSON, undefined)).toBeNull();
    expect(personPhotoHref(PERSON, '')).toBeNull();
    expect(personPhotoHref(null, 'abcdef012345')).toBeNull();
    expect(personPhotoHref('../x', 'abcdef012345')).toBeNull();
    expect(personPhotoHref(PERSON, '"><script>')).toBeNull();
    expect(personPhotoHref(PERSON, 'ABC')).toBeNull();
  });
});
