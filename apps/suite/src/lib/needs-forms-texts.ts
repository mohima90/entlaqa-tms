import 'server-only';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { flattenTexts } from './flatten-texts';

/**
 * Every text of the needs forms library, builder and renderer (namespace `needsForms`, raw: the client
 * fills `{name}`-style placeholders), plus the words for required / optional fields (design principles §4).
 */
export function needsFormsTexts(locale: AppLocale): Record<string, string> {
  const messages = getMessages(locale);
  return {
    ...flattenTexts(messages.needsForms),
    markerRequired: messages.common.required,
    markerOptional: messages.common.optional,
  };
}
