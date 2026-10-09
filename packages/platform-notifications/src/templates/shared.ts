import type { AppLocale } from '@jadarat/platform-i18n';
import { z } from 'zod';

/**
 * One line of plain text: no control characters or line/paragraph separators, and no bidirectional
 * embedding, override or isolate controls (they can make a name display as something else).
 * Joiners and direction marks used in Arabic text stay allowed.
 */
export const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !/[\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/u.test(v),
      'single line, plain',
    );

/** A name in Arabic and, where known, English. */
export const Localized = (max: number) =>
  z.strictObject({ ar: text(max), en: text(max).nullable() });

/** Product label in the header (approved screen 7). */
export const PRODUCT: Readonly<Record<AppLocale, string>> = {
  ar: 'جدارات · التدريب',
  en: 'Jadarat · Training',
};

/** Footer signature (approved screen 7). */
export const SIGNATURE: Readonly<Record<AppLocale, string>> = {
  ar: 'جدارات · منصة ENTLAQA',
  en: 'Jadarat · an ENTLAQA platform',
};

/** The name in this language; English falls back to the Arabic name. */
export function localizedName(value: { ar: string; en: string | null }, locale: AppLocale): string {
  return locale === 'ar' ? value.ar : (value.en ?? value.ar);
}
