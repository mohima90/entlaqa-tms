import type { AppError } from '@jadarat/platform-core';

/** First field-error code per field path of a VALIDATION_FAILED answer (codes only, no values). */
export function fieldErrorCodes(error: AppError): Readonly<Record<string, string>> {
  const codes: Record<string, string> = {};
  for (const fieldError of error.fieldErrors ?? []) {
    codes[fieldError.path] ??= fieldError.code;
  }
  return codes;
}
