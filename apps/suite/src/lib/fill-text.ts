/**
 * Fills a raw message for client components (no i18n runtime in the browser): `{name}` and the number
 * forms `{name, number}` / `{name, number, integer}` get the value (numbers formatted for the locale);
 * plural and select forms are never sent raw — the server formats those.
 */
const PLACEHOLDER = /\{(\w+)(?:, number(?:, integer)?)?\}/g;

export function fillText(
  template: string,
  values: Readonly<Record<string, string | number>>,
  locale = 'ar',
): string {
  // As the server's formats (ADR 0007 §1): Western digits, the locale's separators.
  const format = new Intl.NumberFormat(`${locale === 'en' ? 'en' : 'ar'}-u-nu-latn`, {
    maximumFractionDigits: 1,
  });
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    if (!Object.hasOwn(values, name)) return whole;
    const value = values[name];
    return typeof value === 'number' ? format.format(value) : String(value);
  });
}
