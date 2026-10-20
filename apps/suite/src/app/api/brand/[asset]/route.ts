import { brandImageResponse } from '../../../../lib/brand-asset-route';

export const dynamic = 'force-dynamic';

/**
 * A published branding image (WP-ADM-02, FR-ADM-07, FR-NTF-02; docs/engineering/branding.md): the
 * organization's logo, favicon or sign-in picture for its sign-in page, browser tab and e-mails — read
 * WITHOUT a session (the sign-in page and mail clients have none), by the copy's random id only, through the
 * claim-less private.public_brand_asset (organizations in service, images their Branding still uses).
 * A read: nothing changes, no tenant data but the image.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
): Promise<Response> {
  const { asset } = await params;
  return brandImageResponse(asset);
}
