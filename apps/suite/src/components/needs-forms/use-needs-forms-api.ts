'use client';
import type { AppError } from '@jadarat/platform-core';
import { useMemo, useSyncExternalStore } from 'react';
import { type NeedsFormsApi, liveApi, previewApi } from '../../lib/needs-forms-api';
import { previewSnapshot } from '../../lib/needs-forms-preview';
import { fillText } from '../../lib/fill-text';
import { type ErrorTexts, errorText } from '../auth/error-text';

export type NeedsFormsMode = 'live' | 'preview';

/** The server actions, or the tab's preview copy when the environment has no database. */
export function useNeedsFormsApi(mode: NeedsFormsMode): NeedsFormsApi {
  return useMemo(() => (mode === 'live' ? liveApi : previewApi()), [mode]);
}

const noSubscription = () => () => undefined;

/**
 * The tab's preview copy (a JSON string; null on the server and while hydrating): read from sessionStorage
 * during render, without an effect.
 */
export function usePreviewSnapshot(enabled: boolean): string | null {
  return useSyncExternalStore(
    noSubscription,
    () => (enabled ? previewSnapshot() : null),
    () => null,
  );
}

/** A text of the `needsForms` namespace with its placeholders filled. */
export function textsOf(texts: Readonly<Record<string, string>>, locale: 'ar' | 'en') {
  return (key: string, values: Record<string, string | number> = {}) =>
    fillText(texts[key] ?? key, values, locale);
}

/**
 * The words for an action error: a field error's own text (namespace `needsForms.fieldErrors`) when there is
 * one, the version / not-found texts, else the platform error text.
 */
export function needsFormsErrorText(
  error: AppError,
  text: (key: string) => string,
  errors: ErrorTexts,
): string {
  const code = error.fieldErrors?.[0]?.code;
  if (error.code === 'VALIDATION_FAILED' && code) {
    const own = text(`fieldErrors.${code}`);
    return own === `fieldErrors.${code}` ? text('fieldErrors.INVALID') : own;
  }
  if (error.code === 'CONFLICT_VERSION') return text('conflict');
  if (error.code === 'NOT_FOUND') return text('notFound');
  return errorText(error, errors);
}

/** Field errors by input path (`nameEn`, `options`, …) → their text. */
export function fieldErrorTexts(
  error: AppError,
  text: (key: string) => string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const fieldError of error.fieldErrors ?? []) {
    const own = text(`fieldErrors.${fieldError.code}`);
    result[fieldError.path] ??=
      own === `fieldErrors.${fieldError.code}` ? text('fieldErrors.INVALID') : own;
  }
  return result;
}
