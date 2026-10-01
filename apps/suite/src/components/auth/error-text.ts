import type { AppError } from '@jadarat/platform-core';

/** Message texts by messageKey, translated on the server (no client-side i18n runtime). */
export type ErrorTexts = Readonly<Record<string, string>>;

/** The localized text for an action error; unknown keys fall back to the internal-error text. */
export function errorText(error: AppError, texts: ErrorTexts): string {
  const template = texts[error.messageKey] ?? texts['errors.internalError'] ?? error.code;
  return template.replace('{correlationId}', error.correlationId ?? '');
}
