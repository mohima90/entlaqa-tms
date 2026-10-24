const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The address of a published branding image for e-mail clients (they fetch it without a session). */
export function brandAssetUrl(
  appBaseUrl: string | undefined,
  assetId: string | null,
): string | null {
  if (!appBaseUrl || !assetId || !ASSET_ID.test(assetId)) return null;
  // Trailing slashes trimmed without a regular expression (CodeQL: polynomial regex on input).
  let end = appBaseUrl.length;
  while (end > 0 && appBaseUrl[end - 1] === '/') end -= 1;
  return `${appBaseUrl.slice(0, end)}/api/brand/${assetId}`;
}
