'use client';
import type { AppError } from '@jadarat/platform-core';
import { useCallback } from 'react';
import { fillText } from '../../lib/fill-text';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { useLatestVersion } from '../latest-version';

/** Field error codes of the training plan's actions → their text under `fieldErrors.*`. */
const FIELD_ERROR_KEYS: Readonly<Record<string, string>> = {
  REQUIRED: 'fieldErrors.required',
  TOO_SMALL: 'fieldErrors.invalid',
  TOO_BIG: 'fieldErrors.tooBig',
  INVALID_AMOUNT: 'fieldErrors.invalidAmount',
  ABOVE_MAXIMUM: 'fieldErrors.minAboveMax',
  ONLY_NEED: 'fieldErrors.onlyNeed',
};

/**
 * Texts of the Plan tab (namespace `trainingPlan`, raw strings translated on the server; the client fills
 * placeholders and plural forms) and how an action's refusal reads: a version conflict loads the latest copy
 * (actions without typed input) or offers it (popups with typed input) — WP-FIX-03.
 */
export function usePlanTexts(
  texts: Readonly<Record<string, string>>,
  errors: ErrorTexts,
  locale: 'ar' | 'en',
) {
  const t = useCallback(
    (key: string, values: Readonly<Record<string, string | number>> = {}) =>
      fillText(texts[key] ?? key, values, locale),
    [texts, locale],
  );
  const message = useCallback((error: AppError): string => errorText(error, errors), [errors]);
  const latestVersion = useLatestVersion();
  const sessionRefused = useSessionRefusal();
  /** An action without typed input: a conflict reloads the page's data and says so. */
  const actionMessage = useCallback(
    (error: AppError): string => latestVersion.refresh(error, message(error)) ?? message(error),
    [latestVersion, message],
  );
  /** A popup with typed input: what was typed stays, «Load the latest version» is offered. */
  const formMessage = useCallback(
    (error: AppError): string => latestVersion.offer(error, message(error)) ?? message(error),
    [latestVersion, message],
  );
  const fieldErrors = useCallback(
    (error: AppError): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const fieldError of error.fieldErrors ?? []) {
        const key = fieldError.path.split('.')[0] ?? fieldError.path;
        out[key] ??= t(FIELD_ERROR_KEYS[fieldError.code] ?? 'fieldErrors.invalid');
      }
      return out;
    },
    [t],
  );
  return { t, message, actionMessage, formMessage, fieldErrors, sessionRefused };
}

export type PlanTexts = ReturnType<typeof usePlanTexts>;
