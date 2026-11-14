/**
 * An organization's two names for the readers that write to people — e-mails, their subjects and sender
 * names, the sign-up page of an invitation. An organization is named in at least one language
 * (platform.tenants, tenants_name_present_check, 20261113120000; PO 12 Nov 2026): the Arabic slot carries the
 * name that exists when the organization has no Arabic name, exactly as a person's does in the same e-mails
 * (`coalesce(display_name_ar, display_name_en)`), so every template keeps showing a name in both languages.
 * `en` stays the English name alone: English falls back to the Arabic slot where it is missing.
 */
export interface OrganizationNames {
  readonly ar: string;
  readonly en: string | null;
}

const given = (value: string | null | undefined): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** The names as stored (either may be missing) → the pair e-mails and the sign-up page show. */
export function organizationNames(
  nameAr: string | null | undefined,
  nameEn: string | null | undefined,
): OrganizationNames {
  const en = given(nameEn);
  return { ar: given(nameAr) ?? en ?? '', en };
}
