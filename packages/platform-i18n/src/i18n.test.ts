import { describe, expect, it } from 'vitest';
import ar from '../messages/ar.json';
import en from '../messages/en.json';
import { defaultLocale, getDirection, getMessages, isLocale, locales, otherLocale } from './index';
import { routing } from './routing';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('locales', () => {
  it('defaults to Arabic and supports English', () => {
    expect(defaultLocale).toBe('ar');
    expect(locales).toEqual(['ar', 'en']);
    expect(routing.defaultLocale).toBe('ar');
    expect(routing.localePrefix).toBe('always');
  });

  it('maps direction and toggles locales', () => {
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('en')).toBe('ltr');
    expect(otherLocale('ar')).toBe('en');
    expect(otherLocale('en')).toBe('ar');
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('messages', () => {
  it('Arabic and English catalogs have exactly the same keys', () => {
    expect(keys(en).sort()).toEqual(keys(ar).sort());
  });

  it('no message is empty', () => {
    const values = (obj: object): unknown[] =>
      Object.values(obj as Record<string, unknown>).flatMap((v): unknown[] =>
        typeof v === 'object' && v !== null ? values(v) : [v],
      );
    for (const catalog of [ar, en]) {
      for (const value of values(catalog)) {
        expect(typeof value === 'string' && value.trim().length > 0).toBe(true);
      }
    }
    expect(getMessages('ar').common.productName).toBe('جدارات · التدريب');
    expect(getMessages('en').common.productName).toBe('Jadarat · Training');
  });
});
