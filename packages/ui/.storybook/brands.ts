import {
  type Hex,
  type OrganizationBrand,
  brandLayerCss,
  deriveOrganizationBrand,
  jadaratLmsTheme,
  normalizeHex,
  themeCss,
} from '../src/theme';

/**
 * Brand switcher of the Storybook theme preview (T-M2-04c). `jadarat` is the shipped look (loaded by
 * styles.css, nothing injected); the others are injected as a stylesheet after it, exactly like a
 * theme swap or an organization's brand layer would be in the app.
 */
export const BRAND_IDS = ['jadarat', 'jadarat-lms', 'organization'] as const;
export type BrandId = (typeof BRAND_IDS)[number];

/**
 * Sample organization colours to try FR-ADM-07 (any colour also works through the URL, e.g.
 * `&globals=brand:organization;brandColor:2A9D8F`). Samples only — NOT Jadarat LMS colours, which
 * come from the PO's material.
 */
export const SAMPLE_ORGANIZATION_COLOURS = [
  { value: '7B2CBF', title: 'Purple #7B2CBF' },
  { value: 'FFD500', title: 'Yellow #FFD500 (too light: adjusted)' },
  { value: 'C1121F', title: 'Red #C1121F' },
  { value: '1E3A8A', title: 'Navy #1E3A8A' },
  { value: '2A9D8F', title: 'Teal #2A9D8F' },
  { value: '000000', title: 'Black #000000' },
] as const;
export const DEFAULT_ORGANIZATION_COLOUR = '7B2CBF';

/** Brands the story gate (e2e/stories.spec.ts) also runs for stories tagged `brand-matrix`. */
export const BRAND_MATRIX = [
  { brand: 'jadarat-lms', brandColor: DEFAULT_ORGANIZATION_COLOUR },
  { brand: 'organization', brandColor: '7B2CBF' },
  { brand: 'organization', brandColor: 'FFD500' },
] as const;

export interface ActiveBrand {
  readonly id: BrandId;
  /** Stylesheet to load after the shipped theme ('' for the shipped look). */
  readonly css: string;
  /** The organization brand, when `id` is `organization`. */
  readonly organization: OrganizationBrand | null;
}

export function brandId(value: unknown): BrandId {
  return (BRAND_IDS as readonly unknown[]).includes(value) ? (value as BrandId) : 'jadarat';
}

/** `7B2CBF` / `#7B2CBF` from a global → `#7B2CBF`; anything else → the default sample. */
export function organizationColour(value: unknown): Hex {
  const raw = typeof value === 'string' ? value : '';
  return normalizeHex(raw.startsWith('#') ? raw : `#${raw}`) ?? `#${DEFAULT_ORGANIZATION_COLOUR}`;
}

export function activeBrand(globals: Record<string, unknown>): ActiveBrand {
  const id = brandId(globals.brand);
  if (id === 'jadarat-lms') return { id, css: themeCss(jadaratLmsTheme), organization: null };
  if (id === 'organization') {
    const organization = deriveOrganizationBrand({
      primary: organizationColour(globals.brandColor),
    });
    return { id, css: brandLayerCss(organization.layer), organization };
  }
  return { id, css: '', organization: null };
}
