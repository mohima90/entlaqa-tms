'use client';
import type { AppError } from '@jadarat/platform-core';
import { useCallback } from 'react';
import type { FieldText } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useLatestVersion } from '../latest-version';
import { type Failure, failureOf } from './failure';

type FailureOf = (
  error: AppError,
  text: (key: string) => string,
  errors: ErrorTexts,
  fieldText: (path: string, code: string) => FieldText,
) => Failure;

/**
 * `failureOf` for the structure pages, with the automatic reload (WP-FIX-03; PO, 12 Nov 2026): a change
 * refused because the page was older no longer asks for a refresh by hand.
 *
 *   - `actionFailure` — row actions and confirmations (activate, delete, move, reorder): the page loads the
 *     latest version itself and the message says so;
 *   - `formFailure` — the add / edit forms: what was typed stays, and «Load the latest version» is offered.
 */
export function useFailure(): {
  readonly actionFailure: FailureOf;
  readonly formFailure: FailureOf;
} {
  const latestVersion = useLatestVersion();
  const actionFailure = useCallback<FailureOf>(
    (error, text, errors, fieldText) => {
      const failure = failureOf(error, text, errors, fieldText);
      const latest = latestVersion.refresh(error, failure.message ?? '');
      return latest === null ? failure : { fields: {}, message: latest, latest: true };
    },
    [latestVersion],
  );
  const formFailure = useCallback<FailureOf>(
    (error, text, errors, fieldText) => {
      const failure = failureOf(error, text, errors, fieldText);
      const latest = latestVersion.offer(error, failure.message ?? '');
      return latest === null ? failure : { fields: {}, message: latest };
    },
    [latestVersion],
  );
  return { actionFailure, formFailure };
}
