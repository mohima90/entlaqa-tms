import type { AppError } from '@jadarat/platform-core';

/** Message texts by messageKey, translated on the server (no client-side i18n runtime). */
export type ErrorTexts = Readonly<Record<string, string>>;

/**
 * The localized text for an action error; unknown keys fall back to the internal-error text. Placeholders
 * are filled from the error's params (e.g. `{min}` for the password rule, T-M2-10).
 */
export function errorText(error: AppError, texts: ErrorTexts): string {
  const template = texts[error.messageKey] ?? texts['errors.internalError'] ?? error.code;
  let text = template.replace('{correlationId}', error.correlationId ?? '');
  for (const [name, value] of Object.entries(error.params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}
