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
    // Redesign package 4: the builder's unsaved note and the library's Undo.
    unsavedChanges: messages.common.unsavedChanges,
    undo: messages.common.undo,
    breadcrumbLabel: messages.planning.breadcrumb.label,
    breadcrumbPlanning: messages.planning.breadcrumb.planning,
  };
}
