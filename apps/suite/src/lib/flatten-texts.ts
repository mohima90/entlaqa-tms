/** Every text of a message namespace as raw strings by dotted key (client forms fill placeholders). */
export function flattenTexts(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  if (typeof node !== 'object' || node === null) return {};
  return Object.assign(
    {},
    ...Object.entries(node).map(([key, value]) =>
      flattenTexts(value, prefix ? `${prefix}.${key}` : key),
    ),
  ) as Record<string, string>;
}
