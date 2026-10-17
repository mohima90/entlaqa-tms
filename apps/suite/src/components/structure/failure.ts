import type { AppError } from '@jadarat/platform-core';
import type { FieldText } from '../../lib/structure-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

/** What a form shows after a refused action: texts per field and one message for the whole form. */
export interface Failure {
  readonly fields: Readonly<Record<string, string>>;
  readonly message: string | null;
}

/**
 * Turns an action's error into the form's texts (EP-ORG forms): field errors through `fieldText` (codes only),
 * a version conflict or a vanished row as the page's own sentence, anything else as the platform's error text.
 */
export function failureOf(
  error: AppError,
  text: (key: string) => string,
  errors: ErrorTexts,
  fieldText: (path: string, code: string) => FieldText,
): Failure {
  if (error.code === 'CONFLICT_VERSION') return { fields: {}, message: text('conflict') };
  if (error.code === 'NOT_FOUND') return { fields: {}, message: text('notFound') };
  if (error.code !== 'VALIDATION_FAILED') return { fields: {}, message: errorText(error, errors) };
  const fields: Record<string, string> = {};
  let message: string | null = null;
  for (const [path, code] of Object.entries(fieldErrorCodes(error))) {
    const { field, key } = fieldText(path, code);
    if (field === 'form') message ??= text(key);
    else fields[field] ??= text(key);
  }
  return {
    fields,
    message: message ?? (Object.keys(fields).length > 0 ? null : errorText(error, errors)),
  };
}
