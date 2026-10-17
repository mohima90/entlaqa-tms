/**
 * A unit's level ordinal as read (platform.departments.level_ordinal, smallint): a number, or null for none
 * (a branch, or a row without the column).
 */
export function levelOrdinalOf(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return Number(value);
  return null;
}
