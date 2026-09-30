declare const uuidBrand: unique symbol;
/** A UUID string that has been validated. */
export type Uuid = string & { readonly [uuidBrand]: true };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function parseUuid(value: unknown): Uuid | null {
  return isUuid(value) ? value : null;
}
