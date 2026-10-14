import { describe, expect, it } from 'vitest';
import {
  DATE_DISPLAYS,
  INDUSTRIES,
  countryName,
  countryTimeZones,
  currencyLabel,
  ianaTimeZones,
  isTimeZone,
  isoCountryCodes,
  isoCurrencyCodes,
  offsetMinutes,
  timeZoneCity,
  timeZoneLabel,
  utcOffset,
} from './regional';

const AT = new Date('2026-10-14T11:05:00Z');

describe('regional reference data (T-M2-22)', () => {
  it('has the fixed industry list of the approved screen and three date displays', () => {
    expect(INDUSTRIES).toHaveLength(15);
    expect(INDUSTRIES[0]).toBe('government');
    expect(INDUSTRIES.at(-1)).toBe('other');
    expect(DATE_DISPLAYS).toEqual(['gregorian', 'hijri', 'dual']);
  });

  it('lists ISO 3166-1 countries from ICU, without groupings, reserved or withdrawn codes', () => {
    const codes = isoCountryCodes();
    for (const code of [
      'SA',
      'AE',
      'EG',
      'KW',
      'QA',
      'BH',
      'OM',
      'JO',
      'US',
      'GB',
      'MM',
      'RS',
      'CD',
      'AQ',
    ]) {
      expect(codes).toContain(code);
    }
    for (const code of [
      'EU',
      'EZ',
      'UN',
      'XK',
      'XA',
      'QO',
      'ZZ',
      'AC',
      'IC',
      'BU',
      'YU',
      'ZR',
      'UK',
      'SU',
    ]) {
      expect(codes).not.toContain(code);
    }
    // ISO 3166-1 assigns 249 codes; allow ICU to differ by a few between versions.
    expect(codes.length).toBeGreaterThanOrEqual(245);
    expect(codes.length).toBeLessThanOrEqual(252);
    expect(isoCountryCodes()).toBe(codes); // cached
  });

  it('lists ISO 4217 currencies without metals, funds and test codes', () => {
    const codes = isoCurrencyCodes();
    for (const code of [
      'SAR',
      'AED',
      'EGP',
      'KWD',
      'QAR',
      'BHD',
      'OMR',
      'JOD',
      'USD',
      'EUR',
      'XAF',
      'XOF',
    ]) {
      expect(codes).toContain(code);
    }
    for (const code of ['XAU', 'XDR', 'XSU', 'XXX', 'XTS']) expect(codes).not.toContain(code);
    expect(isoCurrencyCodes()).toBe(codes);
  });

  it('lists IANA time zones and recognizes one', () => {
    expect(ianaTimeZones()).toContain('Asia/Riyadh');
    expect(ianaTimeZones()).toBe(ianaTimeZones());
    expect(isTimeZone('Africa/Cairo')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
  });

  it('names countries and currencies in the UI language', () => {
    expect(countryName('SA', 'en')).toBe('Saudi Arabia');
    expect(countryName('SA', 'ar')).toBe('المملكة العربية السعودية');
    expect(currencyLabel('SAR', 'en')).toMatch(/^SAR — Saudi [Rr]iyal$/);
    expect(currencyLabel('SAR', 'ar')).toBe('SAR — ريال سعودي');
    expect(currencyLabel('QQQ', 'en')).toBe('QQQ');
  });

  it('labels time zones with a friendly city and the UTC offset', () => {
    expect(utcOffset('Asia/Riyadh', AT)).toBe('UTC+03:00');
    expect(utcOffset('UTC', AT)).toBe('UTC+00:00');
    expect(utcOffset('America/Argentina/Buenos_Aires', AT)).toBe('UTC-03:00');
    expect(timeZoneLabel('Asia/Riyadh', 'en', AT)).toBe('Riyadh (UTC+03:00)');
    expect(timeZoneLabel('Asia/Riyadh', 'ar', AT)).toBe('الرياض (UTC+03:00)');
    expect(timeZoneCity('America/Argentina/Buenos_Aires', 'ar')).toBe('Buenos Aires');
    expect(offsetMinutes('Asia/Kathmandu', AT)).toBe(345);
    expect(offsetMinutes('America/New_York', AT)).toBe(-240);
    expect(offsetMinutes('UTC', AT)).toBe(0);
  });

  it('knows the time zones of a country', () => {
    expect(countryTimeZones('SA')).toEqual(['Asia/Riyadh']);
    expect(countryTimeZones('US').length).toBeGreaterThan(1);
  });
});
