import { detectType } from './detect';
import { type ImageSize, imageSize, imageTypeOf, stripImageMetadata } from './image-info';
import { FILE_PURPOSES, declaredTypeFor } from './purposes';

/**
 * Branding images (WP-ADM-02, FR-ADM-07, BR-BRD-b): the purpose of each image of the Branding page and the
 * checks by NAME (before an upload: the extension must name PNG, JPEG or WebP) and by CONTENT (the type
 * detected from the bytes — never the name or the browser's type; SVG, GIF, HTML and anything else is
 * refused). The worker's scan applies the same purposes; the publishing task checks the content again before
 * a copy goes public, caps the size in pixels and removes the metadata (prepareBrandImage).
 */

export const BRAND_IMAGE_PURPOSES = {
  logo: 'platform.brand_logo',
  favicon: 'platform.brand_favicon',
  sign_in_image: 'platform.brand_sign_in_image',
} as const;

export type BrandImageSlot = keyof typeof BRAND_IMAGE_PURPOSES;
export type BrandImagePurpose = (typeof BRAND_IMAGE_PURPOSES)[BrandImageSlot];

export const BRAND_IMAGE_SLOTS = Object.keys(BRAND_IMAGE_PURPOSES) as readonly BrandImageSlot[];

export function isBrandImageSlot(value: string): value is BrandImageSlot {
  return Object.hasOwn(BRAND_IMAGE_PURPOSES, value);
}

/** The largest file of the slot, in bytes (logo 2 MB, favicon 500 KB, sign-in image 5 MB). */
export function brandImageMaxBytes(slot: BrandImageSlot): number {
  return FILE_PURPOSES[BRAND_IMAGE_PURPOSES[slot]].maxBytes;
}

/** The largest side in pixels (security review L8): 4096 px, the browser icon 512 px. */
export const BRAND_IMAGE_MAX_SIDE: Readonly<Record<BrandImageSlot, number>> = {
  logo: 4096,
  favicon: 512,
  sign_in_image: 4096,
};

export type BrandImageRefusal =
  'TYPE_NOT_ALLOWED' | 'TOO_LARGE' | 'EMPTY' | 'DIMENSIONS_TOO_LARGE' | 'MALFORMED';

/** Before an upload: the name's extension and the size (the server reserves only then). */
export function checkBrandImageUpload(
  slot: BrandImageSlot,
  name: string,
  size: number,
): BrandImageRefusal | null {
  if (declaredTypeFor(BRAND_IMAGE_PURPOSES[slot], name) === null) return 'TYPE_NOT_ALLOWED';
  if (!Number.isSafeInteger(size) || size < 1) return 'EMPTY';
  if (size > brandImageMaxBytes(slot)) return 'TOO_LARGE';
  return null;
}

/**
 * By content: the type detected from the bytes when the slot accepts it, else the refusal. `bytes` is the
 * whole file (branding images are small).
 */
export async function checkBrandImageContent(
  slot: BrandImageSlot,
  bytes: Uint8Array,
): Promise<{ readonly type: string } | { readonly refused: BrandImageRefusal }> {
  if (bytes.length === 0) return { refused: 'EMPTY' };
  if (bytes.length > brandImageMaxBytes(slot)) return { refused: 'TOO_LARGE' };
  const type = await detectType(bytes, true);
  const allowed: readonly string[] = FILE_PURPOSES[BRAND_IMAGE_PURPOSES[slot]].types;
  return type !== null && allowed.includes(type) ? { type } : { refused: 'TYPE_NOT_ALLOWED' };
}

/** The size in pixels within the slot's cap? null when it is, else the refusal (null size: MALFORMED). */
export function checkBrandImageDimensions(
  slot: BrandImageSlot,
  size: ImageSize | null,
): BrandImageRefusal | null {
  if (size === null) return 'MALFORMED';
  const max = BRAND_IMAGE_MAX_SIDE[slot];
  return size.width > max || size.height > max ? 'DIMENSIONS_TOO_LARGE' : null;
}

/**
 * Before a copy goes public (worker): the type by content, the size in pixels from the header, and the
 * bytes WITHOUT metadata (EXIF with GPS, XMP, IPTC, comments; image-info.ts). The copy is what the browser,
 * the sign-in page and e-mails receive; the scanned original stays private.
 */
export async function prepareBrandImage(
  slot: BrandImageSlot,
  bytes: Uint8Array,
): Promise<
  | { readonly type: string; readonly content: Uint8Array; readonly size: ImageSize }
  | { readonly refused: BrandImageRefusal }
> {
  const checked = await checkBrandImageContent(slot, bytes);
  if ('refused' in checked) return checked;
  if (imageTypeOf(bytes) !== checked.type) return { refused: 'MALFORMED' };
  const size = imageSize(bytes);
  const tooLarge = checkBrandImageDimensions(slot, size);
  if (tooLarge !== null || size === null) return { refused: tooLarge ?? 'MALFORMED' };
  const content = stripImageMetadata(bytes);
  if (content === null) return { refused: 'MALFORMED' };
  return { type: checked.type, content, size };
}
