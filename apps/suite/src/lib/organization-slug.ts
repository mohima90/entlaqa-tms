/**
 * An organization's short name (its future subdomain; FR-ADM-17): 3–40 lowercase letters, digits and
 * hyphens, no hyphen at either end — the database checks the same (private.platform_create_tenant).
 */
export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;
const SLUG_ENDS = /^[a-z0-9](?:.*[a-z0-9])?$/;

export function isOrganizationSlug(value: string): boolean {
  return ORGANIZATION_SLUG_PATTERN.test(value) && SLUG_ENDS.test(value);
}
