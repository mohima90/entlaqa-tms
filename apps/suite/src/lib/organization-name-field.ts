/**
 * The organization's name that «Create organization» requires (WP-UX-01 d; PO 12 Nov 2026): the one in the
 * language chosen for the organization in the same popup — the other language is optional. Shared by the
 * popup (the red asterisk, the message) and the action's validation (lib/platform-console-input); the
 * database refuses only an organization without any name (tenants_name_present_check, 20261113120000).
 */
export function organizationNameField(locale: 'ar' | 'en'): 'nameAr' | 'nameEn' {
  return locale === 'ar' ? 'nameAr' : 'nameEn';
}
