/**
 * Bilingual story copy. Arabic comes from the glossary / content style guide
 * (docs/design/content/), never machine translation.
 */
export interface Copy {
  readonly ar: string;
  readonly en: string;
}

export function pick(globals: Record<string, unknown>, copy: Copy): string {
  return globals.locale === 'en' ? copy.en : copy.ar;
}
