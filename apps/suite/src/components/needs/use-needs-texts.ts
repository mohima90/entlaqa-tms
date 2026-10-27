'use client';
import type { AppError } from '@jadarat/platform-core';
import { useCallback } from 'react';
import { fillText } from '../../lib/fill-text';
import { needsFieldErrorKey } from '../../lib/needs-view';
import { type ErrorTexts, errorText } from '../auth/error-text';

/**
 * Texts of the needs pages (namespace `needsEntry`, raw strings translated on the server; the client fills
 * placeholders and plural forms) and how an action error reads.
 */
export function useNeedsTexts(
  texts: Readonly<Record<string, string>>,
  errors: ErrorTexts,
  locale: 'ar' | 'en',
) {
  const t = useCallback(
    (key: string, values: Readonly<Record<string, string | number>> = {}) =>
      fillText(texts[key] ?? key, values, locale),
    [texts, locale],
  );
  /** The general message for an error (the catalog's `errors.*` texts, filled). */
  const message = useCallback((error: AppError): string => errorText(error, errors), [errors]);
  /** Field errors by path, as texts. */
  const fieldErrors = useCallback(
    (error: AppError): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const fieldError of error.fieldErrors ?? []) {
        out[fieldError.path] ??= t(needsFieldErrorKey(fieldError.code));
      }
      return out;
    },
    [t],
  );
  return { t, message, fieldErrors };
}
