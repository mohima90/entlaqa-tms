'use client';
import type { AppError } from '@jadarat/platform-core';
import { useCallback } from 'react';
import { fillText } from '../../lib/fill-text';
import { fieldErrorKey } from '../../lib/planning-view';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useLatestVersion } from '../latest-version';

/**
 * Texts of the planning forms (namespace `planning`, raw strings translated on the server; plural forms
 * are formatted by the server and passed separately) and how an action error reads.
 */
export function usePlanningTexts(
  texts: Readonly<Record<string, string>>,
  errors: ErrorTexts,
  locale: 'ar' | 'en',
) {
  const t = useCallback(
    (key: string, values: Readonly<Record<string, string | number>> = {}) =>
      fillText(texts[key] ?? key, values, locale),
    [texts, locale],
  );
  /** The general message for an error (state refusals of the cycle get the page's own words). */
  const message = useCallback(
    (error: AppError): string => {
      if (error.code === 'CONFLICT_VERSION') return t('setup.conflict');
      if (error.code === 'NOT_FOUND') return t('setup.notFound');
      if (error.code === 'PLAN_CYCLE_NOT_DRAFT') return t('setup.notDraft');
      return errorText(error, errors);
    },
    [t, errors],
  );
  /** Field errors by path, as texts. */
  const fieldErrors = useCallback(
    (error: AppError): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const fieldError of error.fieldErrors ?? []) {
        out[fieldError.path] ??= t(fieldErrorKey(fieldError.code));
      }
      return out;
    },
    [t],
  );
  // An older copy of the page (WP-FIX-03; PO, 12 Nov 2026): nobody is asked to refresh by hand. An action
  // without typed input loads the latest version itself; a form keeps what was typed and offers «Load the
  // latest version».
  const latestVersion = useLatestVersion();
  const actionMessage = useCallback(
    (error: AppError): string => latestVersion.refresh(error, message(error)) ?? message(error),
    [latestVersion, message],
  );
  const formMessage = useCallback(
    (error: AppError): string => latestVersion.offer(error, message(error)) ?? message(error),
    [latestVersion, message],
  );
  return { t, message, actionMessage, formMessage, fieldErrors };
}
