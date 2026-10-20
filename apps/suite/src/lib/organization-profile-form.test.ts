import { describe, expect, it } from 'vitest';
import {
  type ProfileFormValues,
  cleanName,
  firstInvalidField,
  validateOrganizationName,
  normalizeClock,
  profileInput,
  serverFieldError,
  toggleDay,
  validateProfile,
} from './organization-profile-form';

const values: ProfileFormValues = {
  industry: 'banking_financial',
  countryCode: 'SA',
  currencyCode: 'SAR',
  timeZone: 'Asia/Riyadh',
  fiscalYearStartMonth: 1,
  defaultLocale: 'en',
  dateDisplay: 'dual',
  workingDays: [0, 1, 2, 3, 4],
  workStartsAt: '08:00',
  workEndsAt: '16:00',
};

describe('organization profile form (T-M2-22)', () => {
  it('accepts the approved sample', () => {
    expect(validateProfile(values)).toEqual({});
  });

  it('display names (now on Branding, WP-ADM-02): required (trimmed), at most 80 characters', () => {
    expect(validateOrganizationName('  ')).toBe('nameRequired');
    expect(validateOrganizationName('')).toBe('nameRequired');
    expect(validateOrganizationName('ن'.repeat(81))).toBe('nameTooLong');
    expect(validateOrganizationName(` ${'x'.repeat(80)} `)).toBeNull();
    expect(validateOrganizationName('Al \u202ERaya')).toBe('nameInvalid');
    expect(validateOrganizationName('شركة \u2067الراية')).toBe('nameInvalid');
    expect(validateOrganizationName('شركة\u200Cالراية')).toBeNull();
  });

  it('requires an industry, a country and a working day', () => {
    expect(validateProfile({ ...values, industry: '', countryCode: '', workingDays: [] })).toEqual({
      industry: 'industryRequired',
      countryCode: 'countryRequired',
      workingDays: 'daysRequired',
    });
  });

  it('takes 24-hour times, also typed with Arabic digits, the end after the start', () => {
    expect(normalizeClock('8:00')).toBe('08:00');
    expect(normalizeClock(' ٠٩:٣٠ ')).toBe('09:30');
    expect(normalizeClock('۱۷:۰۰')).toBe('17:00');
    expect(normalizeClock('24:00')).toBe('24:00');
    expect(normalizeClock('9.30')).toBe('9.30');
    expect(validateProfile({ ...values, workStartsAt: '9.30' })).toEqual({
      workStartsAt: 'timeInvalid',
    });
    expect(validateProfile({ ...values, workEndsAt: '25:00' })).toEqual({
      workEndsAt: 'timeInvalid',
    });
    expect(validateProfile({ ...values, workEndsAt: '08:00' })).toEqual({
      workEndsAt: 'endBeforeStart',
    });
    expect(validateProfile({ ...values, workStartsAt: '٠٧:٠٠', workEndsAt: '٠٦:٥٩' })).toEqual({
      workEndsAt: 'endBeforeStart',
    });
  });

  it('maps a server field error to the form message', () => {
    expect(serverFieldError('workEndsAt', values)).toBe('endBeforeStart');
    expect(serverFieldError('workingDays.0', values)).toBe('invalid');
    expect(serverFieldError('countryCode', values)).toBe('invalid');
  });

  it('toggles days and keeps the week sorted', () => {
    expect(toggleDay([0, 1, 2, 3, 4], 2)).toEqual([0, 1, 3, 4]);
    expect(toggleDay([1, 3], 0)).toEqual([0, 1, 3]);
    expect(toggleDay([], 6)).toEqual([6]);
  });

  it('sends normalized times and no names (they are saved on Branding)', () => {
    const sent = profileInput({ ...values, workStartsAt: '٠٨:٠٠', workEndsAt: '4:00' });
    expect(sent).toMatchObject({ workStartsAt: '08:00', workEndsAt: '04:00' });
    expect(sent).not.toHaveProperty('nameEn');
    expect(sent).not.toHaveProperty('nameAr');
  });

  it('saves names in NFC (review L3)', () => {
    expect(cleanName(' Cafe\u0301 ')).toBe('Caf\u00e9');
  });

  it('focuses the first field with an error, in page order (review L4)', () => {
    expect(firstInvalidField({ workEndsAt: 'endBeforeStart', industry: 'industryRequired' })).toBe(
      'industry',
    );
    expect(firstInvalidField({ workingDays: 'daysRequired', timeZone: 'invalid' })).toBe(
      'timeZone',
    );
    expect(firstInvalidField({})).toBeNull();
  });
});
