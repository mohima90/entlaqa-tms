import ar from '../messages/ar.json';
import en from '../messages/en.json';
import type { AppLocale } from './locales';

/**
 * UI messages. Arabic is the source language; copy follows docs/design/content/glossary-ar-en.md.
 * Strings marked DRAFT in the glossary await UX-writer review (T-M1-A06) — never machine-translate.
 */
export type Messages = typeof ar;

const catalog: Record<AppLocale, Messages> = { ar, en };

export function getMessages(locale: AppLocale): Messages {
  return catalog[locale];
}
