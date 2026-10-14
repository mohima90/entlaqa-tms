import { describe, expect, it } from 'vitest';
import { flattenTexts } from './flatten-texts';
import { organizationChoices } from './organization-options';

const NOW = new Date('2026-10-14T11:05:00Z');
const current = { countryCode: null, currencyCode: 'SAR', timeZone: 'Asia/Riyadh' };

describe('organization profile choices (T-M2-22)', () => {
  it('names countries and currencies in the UI language, from ICU', () => {
    const en = organizationChoices('en', NOW, current);
    const ar = organizationChoices('ar', NOW, current);
    expect(en.countries.find((c) => c.value === 'SA')?.label).toBe('Saudi Arabia');
    expect(ar.countries.find((c) => c.value === 'SA')?.label).toBe('المملكة العربية السعودية');
    expect(en.countries.some((c) => c.value === 'EU')).toBe(false);
    expect(ar.currencies.find((c) => c.value === 'SAR')?.label).toBe('SAR — ريال سعودي');
    // Sorted by name in the UI language.
    const names = en.countries.map((c) => c.label);
    expect(names).toEqual([...names].sort(new Intl.Collator('en').compare));
  });

  it('labels zones with city and offset, sorted by offset', () => {
    const { timeZones } = organizationChoices('ar', NOW, current);
    expect(timeZones.find((z) => z.value === 'Asia/Riyadh')?.label).toBe('الرياض (UTC+03:00)');
    const riyadh = timeZones.findIndex((z) => z.value === 'Asia/Riyadh');
    const london = timeZones.findIndex((z) => z.value === 'Europe/London');
    expect(london).toBeLessThan(riyadh);
  });

  it('keeps a saved value the runtime no longer lists', () => {
    const choices = organizationChoices('en', NOW, {
      countryCode: 'XK',
      currencyCode: 'XXA',
      timeZone: 'Etc/GMT-3',
    });
    expect(choices.countries[0]?.value).toBe('XK');
    expect(choices.currencies[0]).toEqual({ value: 'XXA', label: 'XXA' });
    expect(choices.timeZones[0]?.value).toBe('Etc/GMT-3');
  });

  it('has months, weekdays from Sunday, the presets and the three previews', () => {
    const en = organizationChoices('en', NOW, current);
    expect(en.months[0]).toEqual({ value: '1', label: 'January' });
    expect(en.months).toHaveLength(12);
    expect(en.weekdays[0]).toEqual({ value: 0, short: 'Sun', long: 'Sunday' });
    expect(organizationChoices('ar', NOW, current).weekdays[5]?.long).toBe('الجمعة');
    expect(en.suggestions.SA).toMatchObject({ currencyCode: 'SAR', dateDisplay: 'dual' });
    expect(en.suggestions.DE).toBeUndefined();
    expect(en.now).toBe(NOW.toISOString());
    expect(en.previews.gregorian).toBe('Wednesday, October 14, 2026');
    expect(en.previews.hijri).toBe('Wednesday, Jumada I 3, 1448 AH');
    expect(en.previews.dual).toBe('Wednesday, October 14, 2026 · Jumada I 3, 1448 AH');
  });
});

describe('flattenTexts', () => {
  it('flattens a namespace to dotted keys', () => {
    expect(flattenTexts({ a: 'x', b: { c: 'y', d: { e: 'z' } }, n: 1 })).toEqual({
      a: 'x',
      'b.c': 'y',
      'b.d.e': 'z',
    });
  });
});
