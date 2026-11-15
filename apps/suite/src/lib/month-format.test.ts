import { describe, expect, it } from 'vitest';
import { formatMonth, monthFormatter, monthsBetween } from './month-format';

describe('months of draft sessions in the organization’s date display (FR-SCH-07)', () => {
  it('writes Gregorian months long, by name and short, in English and Arabic with Western digits', () => {
    expect(formatMonth('2027-01', 'en', 'gregorian')).toBe('January 2027');
    expect(formatMonth('2027-01', 'en', 'gregorian', 'name')).toBe('January');
    expect(formatMonth('2027-01', 'en', 'gregorian', 'short')).toBe('Jan');
    const arabic = formatMonth('2027-01', 'ar', 'gregorian');
    expect(arabic).toContain('2027');
    expect(arabic).not.toMatch(/[٠-٩]/);
    expect(arabic).toMatch(/[؀-ۿ]/);
  });

  it('writes the Hijri months a Gregorian month spans, and both when the organization shows both', () => {
    const hijri = formatMonth('2027-01', 'en', 'hijri');
    expect(hijri).toContain(' – ');
    expect(hijri).toMatch(/1448/);
    expect(formatMonth('2027-01', 'en', 'hijri', 'short')).toContain(' – ');
    const dual = formatMonth('2027-01', 'en', 'dual');
    expect(dual.startsWith('January 2027 · ')).toBe(true);
    expect(formatMonth('2027-01', 'en', 'dual', 'short')).toBe('Jan');
    expect(monthFormatter('en', 'gregorian')('2027-12')).toBe('December 2027');
  });

  it('leaves anything that is not a month as it is', () => {
    expect(formatMonth('2027-13', 'en', 'gregorian')).toBe('2027-13');
  });

  it('lists the months of a planning period', () => {
    expect(monthsBetween('2027-01-01', '2027-03-31')).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(monthsBetween('2027-11', '2028-02')).toEqual([
      '2027-11',
      '2027-12',
      '2028-01',
      '2028-02',
    ]);
    expect(monthsBetween('bad', '2027-01')).toEqual([]);
  });
});
