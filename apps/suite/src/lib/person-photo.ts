/**
 * The address of a person's profile photo (WP-ADM-04): `/api/photo/<person id>?v=<version>` — a same-origin
 * route that answers signed-in members of the organization only. The version (the first characters of the
 * photo's SHA-256) changes with every new photo, so a replaced photo is fetched again and an unchanged one
 * stays in the browser's cache. Null when the person has no photo (initials are shown).
 */
export function personPhotoHref(
  personId: string | null | undefined,
  version: string | null | undefined,
): string | null {
  if (!personId || !version) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(personId)) return null;
  if (!/^[0-9a-f]{6,64}$/.test(version)) return null;
  return `/api/photo/${personId}?v=${version}`;
}
