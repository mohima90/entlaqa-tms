import { describe, expect, it } from 'vitest';
import { countryTimeZones, ianaTimeZones, isoCurrencyCodes } from './regional';
import { COUNTRY_PRESETS, applyPreset, regionalPreset } from './regional-presets';

const catalog = {
  currencies: isoCurrencyCodes(),
  timeZones: ianaTimeZones(),
  timeZonesOf: countryTimeZones,
};

describe('country presets (T-M2-22, approved screen)', () => {
  it('has the approved presets', () => {
    expect(COUNTRY_PRESETS).toEqual({
      SA: {
        currencyCode: 'SAR',
        timeZone: 'Asia/Riyadh',
        workingDays: [0, 1, 2, 3, 4],
        dateDisplay: 'dual',
      },
      AE: {
        currencyCode: 'AED',
        timeZone: 'Asia/Dubai',
        workingDays: [1, 2, 3, 4, 5],
        dateDisplay: 'gregorian',
      },
      EG: {
        currencyCode: 'EGP',
        timeZone: 'Africa/Cairo',
        workingDays: [0, 1, 2, 3, 4],
        dateDisplay: 'gregorian',
      },
      KW: {
        currencyCode: 'KWD',
        timeZone: 'Asia/Kuwait',
        workingDays: [0, 1, 2, 3, 4],
        dateDisplay: 'gregorian',
      },
      QA: {
        currencyCode: 'QAR',
        timeZone: 'Asia/Qatar',
        workingDays: [0, 1, 2, 3, 4],
        dateDisplay: 'gregorian',
      },
      BH: {
        currencyCode: 'BHD',
        timeZone: 'Asia/Bahrain',
        workingDays: [0, 1, 2, 3, 4],
        dateDisplay: 'gregorian',
      },
      OM: {
        currencyCode: 'OMR',
        timeZone: 'Asia/Muscat',
        workingDays: [0, 1, 2, 3, 4],
        dateDisplay: 'gregorian',
      },
      JO: {
        currencyCode: 'JOD',
        timeZone: 'Asia/Amman',
        workingDays: [0, 1, 2, 3, 4],
        dateDisplay: 'gregorian',
      },
    });
    // Every preset value is on offer in this runtime.
    for (const preset of Object.values(COUNTRY_PRESETS)) {
      expect(catalog.currencies).toContain(preset.currencyCode);
      expect(catalog.timeZones).toContain(preset.timeZone);
    }
  });

  it('suggests the full preset for the approved countries', () => {
    expect(regionalPreset('SA', catalog)).toBe(COUNTRY_PRESETS.SA);
    expect(regionalPreset('AE', catalog)).toBe(COUNTRY_PRESETS.AE);
  });

  it('suggests only what is unambiguous for other countries', () => {
    expect(regionalPreset('JP', catalog)).toEqual({ currencyCode: 'JPY', timeZone: 'Asia/Tokyo' });
    // Several US zones: the currency only.
    expect(regionalPreset('US', catalog)).toEqual({ currencyCode: 'USD' });
    // A euro country (no code starting with DE) with two zones: nothing.
    expect(regionalPreset('DE', catalog)).toEqual({});
    // Two Cuban currencies: the zone only.
    expect(
      regionalPreset('CU', {
        currencies: ['CUC', 'CUP', 'USD'],
        timeZones: ['America/Havana'],
        timeZonesOf: () => ['America/Havana'],
      }),
    ).toEqual({ timeZone: 'America/Havana' });
    // A zone the runtime associates but does not offer is not suggested.
    expect(
      regionalPreset('ZW', { currencies: [], timeZones: [], timeZonesOf: () => ['Africa/Harare'] }),
    ).toEqual({});
    expect(regionalPreset('not a code', catalog)).toEqual({});
    expect(regionalPreset('toString', catalog)).toEqual({});
  });

  it('applies only the fields a preset names; the rest stays', () => {
    const values = {
      currencyCode: 'USD',
      timeZone: 'UTC',
      workingDays: [1, 2, 3] as const,
      dateDisplay: 'hijri' as const,
      fiscalYearStartMonth: 4,
    };
    expect(applyPreset(values, COUNTRY_PRESETS.SA)).toEqual({
      currencyCode: 'SAR',
      timeZone: 'Asia/Riyadh',
      workingDays: [0, 1, 2, 3, 4],
      dateDisplay: 'dual',
      fiscalYearStartMonth: 4,
    });
    expect(applyPreset(values, { currencyCode: 'JPY' })).toEqual({
      ...values,
      currencyCode: 'JPY',
    });
    expect(applyPreset(values, {})).toEqual(values);
  });
});
