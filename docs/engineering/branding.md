# Branding: the organization's look (runbook)

> Backlog: **WP-ADM-02** (T-M2-23, T-M2-49) · Requirements: FR-ADM-07, FR-ADM-02 (names), FR-NTF-02 (brand part of e-mails) · Business flow: `docs/business-flows/EP-BRAND-branding.md` (agreed 20 Oct 2026) · Kawadir ATS `/org/branding`

The Organization Admin gives the product the organization's look: names (English, Arabic), logo, favicon, sign-in page picture, primary + secondary colour with «Use gradient», website. Until then — and after «Reset to the Jadarat look» — the shipped Jadarat theme applies (slate `#2F4858` → steel `#33658A`).

| Piece | Where |
|---|---|
| Tables, image rules, publishing and public functions | migrations `20261023100000`–`20261023100300` (`platform.file_purposes` rows, `platform.brand_assets`, `platform.brand_asset_attempts`, `platform.tenant_branding`, `private.*brand*` functions owned by `file_guard`); **no malware scan** for the images (PO, 20 Oct 2026): `20261023100400`–`20261023100600` (`file_purposes.scan_required`, file status `accepted`, `private.publish_brand_image`, Storage's read-back policy) |
| Page | `apps/suite/src/app/[locale]/suite/admin/branding/page.tsx`, `components/branding/branding-form.tsx` (slot states: `lib/brand-image-slot.ts`) |
| Actions and definitions | `apps/suite/src/actions/organization.ts`; `packages/platform-rbac/src/iam/branding.ts` (with the app's file service `lib/branding-files.ts` and colour deriver `lib/branding-view.ts`) |
| Colours, presets, contrast | `packages/ui/src/theme/branding.ts` (+ `organization-brand.ts`, `gradient` option) |
| Where the look applies | shell `components/suite-shell.tsx` + `components/branding/brand-style.tsx`; favicon `app/[locale]/suite/layout.tsx`; sign-in page `app/[locale]/sign-in/page.tsx` + `lib/sign-in-brand.ts`; the other pages before the suite `components/auth/auth-brand-layout.tsx` (their `layout.tsx`); e-mails `packages/platform-notifications/src/layout.ts` |
| Public images | `apps/suite/src/app/api/brand/[asset]/route.ts` (`lib/brand-asset-route.ts`; the proxy's image policy in `proxy.ts`) |
| Publishing | at save time: `packages/platform-files/src/brand-uploads.ts` (read back with the admin's session) + `brand-prepare.ts` (checks, metadata removal, hashes), bound by `apps/suite/src/lib/branding-files.ts`; fallback: the worker's `packages/platform-files/src/jobs/brand-assets.ts` (platform task `platform.brand_assets`); metadata removal and pixel size `packages/platform-files/src/image-info.ts` |
| Tests | pgTAP `supabase/tests/99_branding_*.sql` (+ 00, 10, 20, 80; without a scan: `99_branding_4…7`); unit tests next to the code; E2E `apps/suite/e2e/branding.spec.ts` |

## 1. Who

| Who | Page | Save, upload |
|---|---|---|
| Organization Admin (`platform.tenant.manage`, organization-wide; `organization_only` in the catalogue — never in custom roles) | edits | yes (high risk: the session is confirmed with Auth) |
| A reader of the organization's settings (`platform.tenant.read`, e.g. an Auditor custom role) | read only | no |
| Everyone else (HR Manager, L&D Manager, Learner, …) | refused | no |

The database enforces the same: `tenant_branding_insert` / `_update` policies call `private.actor_may_manage_tenant` (permission-based), the names go through `tenants_update`. Every change is audited (`platform.tenant.branding_changed`: changed fields, before → after; images by **file id and sanitized file name** — read with `private.branding_image_names` before the save releases a replaced image — never their content).

## 2. Images

1. The page checks the name (`.png`, `.jpg`/`.jpeg`, `.webp`), the size (logo 2 MB, favicon 500 KB, sign-in picture 5 MB), the first bytes (PNG/JPEG/WebP signature; SVG, GIF, HTML refused) and the **size in pixels** from the header (at most 4096 px per side, the favicon 512 px) and shows the picked file in the previews at once (`blob:`).
2. Upload through platform-files (ADR 0006, `docs/engineering/files.md`): reservation in the action's transaction (purposes `platform.brand_logo`, `platform.brand_favicon`, `platform.brand_sign_in_image`, owner `platform/tenant_branding/<tenant>`), signed URL after the commit, browser `PUT`, confirmation (`uploaded`; empty, too large or stored with another type: `rejected` at once). **No malware scan** (PO decision 20 Oct 2026 — like Kawadir ATS, so the image shows as soon as it is saved; ADR 0006 amendment): the slot is ready at once («Ready. It shows everywhere as soon as you save.»). **A failed replacement never loses the saved image:** the slot remembers the image it had and puts it back when the start, the upload, the confirmation or the save refuses the new one (`lib/brand-image-slot.ts`).
3. **Save checks and publishes.** *Before* its transaction (`defineAction` `beforeTransaction`: no pooled connection held), the Save action reads each **newly chosen** image — one the saved Branding does not use yet (a short read of the saved row first; security review M2: a save that changes no image never asks Storage) — that the admin may read back: their own new upload; Storage's read policy admits exactly that, while it is `uploaded`, its object still there and at most 24 hours old — with the admin's **own Storage session** (never a Storage key), at most the slot's limit, and prepares it (`readBrandUpload` → `prepareBrandUpload`): type by content (PNG/JPEG/WebP; SVG, GIF, HTML refused), size in pixels from the header (4096 / 512 px, nothing decoded), **metadata removed**, SHA-256 and size of the bytes read. A refusal is the answer, with its reason (wrong type, too large, too many pixels, damaged — English and Arabic), and nothing is saved. Storage unavailable for a new image: the save goes through, the answer names the image as pending — the page says «Branding saved. The new image is shown shortly» — and a worker pass is asked for (`noteWorkQueued`): the worker's fallback (step 4) checks and publishes it. *In* the transaction, after the Branding row: the trigger `tenant_branding_files` accepts only the **saver's own** confirmed upload (`uploaded`, `scanning`, `clean` or `accepted`) of the slot's purpose for this organization (`JB001` otherwise); a **replaced or removed** image is released at once (its public copy deleted, the file marked deleted → purged by housekeeping after 30 days); the saver's other unused branding uploads, and anyone's older than a day, are released too. Then each prepared image is published (`private.publish_brand_image`): an Organization Admin (`platform.tenant.manage`), their own upload, the image the Branding uses for that kind, the size read equal to the stored object's (at confirmation and in Storage now; no Storage object → refused, review L3), the copy no larger than the file and starting with its type's signature (`JB002`/`JB003` otherwise → the save is refused); the file becomes **`accepted`** (detected type, size, SHA-256 — honest: checked by content, never scanned, never `clean`; files.md §1). The copy is public as soon as the save commits: the page refreshes and shows it, the shell, the sign-in page and e-mails use it.
4. **Worker fallback** (`platform.brand_assets`, each pass): an image in use that is not published — the web app could not read it (Storage unavailable at save time; an upload saved before 20 Oct 2026), or an older image the scan found **clean** — is read with the worker's key and prepared the same way; scanned (clean) images keep `private.publish_brand_asset` (the stream checked against the scan's size and SHA-256), images without a scan use `private.publish_brand_image` (the database compares the bytes read with the stored object). Until then the Jadarat image is shown and the page says «Saved, but not shown yet».
5. **Failures in the worker** (a refused type or size, a damaged file, the bytes not matching): recorded in `platform.brand_asset_attempts`; the image is tried again after 2, 4, 8, … minutes (at most a day) and **given up after 5 attempts** — the Branding page then says the image could not be prepared and asks for another. Storage being unavailable is not counted (the pass stops and the next one tries again). Each pass also removes copies no Branding uses any more (a copy published while a save replaced its image).
6. **Raw uploads removed (security review M1).** File housekeeping (each worker pass) removes the Storage object of a branding upload as soon as nothing needs it: once **accepted with its copy published** (the copy in PostgreSQL is what is served), once **deleted** (replaced, removed, abandoned), and **24 hours after the upload while still unpublished** (the record stays while the Branding refers to it — the page asks for another image; an unused one is purged with its record). On hosted Supabase a signed link is checked only when it is made and then works as long as the object exists; with this, a link to the raw bytes lives at most about a day, and only the uploader (an Organization Admin) could make one.

**What still protects the images without a scan** (threat model TM-0002 T-TEN-15, residual RR-TEN-08 — **accepted by the PO, 21 Oct 2026**, with the wording corrected after security review M1: the bytes uploaded under an image purpose need not be an image until the save checks them; a harmful but valid-looking image could become a public logo; only Organization Admins upload them; the 24-hour read-back window is accepted): only raster images users upload into `images` may skip the scan (database check on `platform.file_purposes`); the type by content three times (browser, server, database signature check); size and pixel caps applied while reading; no pixel decoded (no decompression bomb can expand); metadata and anything after the image's end removed (a polyglot tail is dropped); only the stripped copy is public, from our own origin with its detected type, `nosniff` and a sandboxing CSP (§3); the original stays private and is never `clean` (no download grant, no module job reads it); only the Organization Admin's own upload, every change audited. Profile photos, imports and every other purpose are still scanned.

**Metadata removal without an image library** (`image-info.ts`, security review M2): what a phone or an editor writes about a picture — EXIF with the **GPS position** and the device, XMP, IPTC, comments, text chunks, data after the end of the image — is dropped; the pixels and the colour profile are kept byte for byte (nothing is decoded or re-encoded). Allow-lists: PNG keeps its critical chunks and the colour, transparency, pixel-size and animation chunks (drops `eXIf`, `tEXt`, `iTXt`, `zTXt`, `tIME`, private chunks); JPEG keeps the coding segments, JFIF `APP0`, the ICC profile `APP2` and Adobe `APP14` (drops `APP1` EXIF/XMP, `APP13` IPTC, other `APPn`, comments, anything after `EOI`); WebP keeps the image, alpha, animation and ICC chunks (drops `EXIF`, `XMP `, clears their `VP8X` flags and fixes the RIFF size). A file that does not parse is refused. Re-encoding with `sharp` (ADR 0006 §3) stays a follow-up that needs the PO's acceptance of `sharp`/libvips (LGPL-3.0), as for profile photos (files.md §8); stripping covers the privacy risk without it.

## 3. Serving images without a session — the design

The sign-in page (before anyone signs in), the browser tab and **mail clients** need the images without a session; uploaded files must stay private (no public bucket, no long-lived Storage links, no Storage key in the web app — ADR 0006).

**Choice: a published copy in PostgreSQL, served by the app at `/api/brand/<id>`.**

| Property | How |
|---|---|
| Only safe content public | only PNG/JPEG/WebP by content (checked in the browser, on the server and by signature in the database), copied when the bytes equal the stored upload's (size; for scanned images also the scan's SHA-256); not virus-scanned since 20 Oct 2026 (PO decision, §2) |
| Only what is needed | the copy has no metadata (no GPS position, device, author — see §2) |
| Not listable | no index or listing route; `<id>` is a random UUID (122 random bits), not the file id; the only readers are `private.public_brand_asset(id)` and `private.public_brand_asset_meta(id)` (claim-less `app_server` transactions) |
| Per tenant, revocable | a copy is served only while its organization is in service (`trial`/`active`) and its Branding still uses that image; replacing or removing an image deletes its copy at once |
| Browser safety | `Content-Type` = the detected type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: default-src 'none'; sandbox` — set by the proxy for every `/api/brand/` answer instead of the page CSP (also on 404 and 429; checked by E2E on the real response) |
| Caching | `Cache-Control: public, max-age=86400, s-maxage=86400` and `CDN-Cache-Control: public, max-age=86400` (one day: a removed image stops being served by our side within a day), `ETag` = the copy's SHA-256. A revalidation (`If-None-Match`) is answered **304 from a metadata query — the bytes are not read** |
| Load on the database | full answers (200) are rate-limited with the shared limiter (bucket `brand.images`): 120 per client per minute, 1200 per minute shared by visitors without a trusted client address; past it `429` with `Retry-After`. The limiter fails open (logged): an image decides nothing about access. With the CDN / proxy cache in front, repeated requests do not reach the app |
| E-mail clients | `Cross-Origin-Resource-Policy: cross-origin` for `/api/brand/*` only (next.config.ts); the e-mail links `${APP_BASE_URL}/api/brand/<id>` |
| CSP of our pages | same origin: `img-src 'self'` holds; previews of picked files use `blob:` (already allowed) |
| Sovereign | plain PostgreSQL + the app; the same on hosted Supabase and self-hosted (no Storage public bucket, no gateway change) |

Alternatives not chosen: a public Storage bucket (vendor feature, listing and policy risk, another origin in the CSP, gateway changes self-hosted); long-lived signed URLs (hosted Storage cannot bound them per tenant or revoke them, see files.md §6 RR-FIL-01). Size: at most 7.5 MB per organization in the database (2 + 0.5 + 5 MB).

**Self-hosted: cache `/api/brand/` in the reverse proxy.** Vercel's CDN honours `CDN-Cache-Control` / `s-maxage` on its own; an in-country installation should let its reverse proxy keep the images too, so that a burst of sign-in pages or e-mail opens does not stream them from PostgreSQL each time. nginx example (the cache follows the app's headers; at most a day):

```nginx
proxy_cache_path /var/cache/nginx/brand levels=1:2 keys_zone=brand:10m max_size=500m inactive=1d;
location /api/brand/ {
  proxy_pass         http://suite:3000;
  proxy_cache        brand;
  proxy_cache_valid  200 1d;            # 404 / 429 are never cached (no-store)
  proxy_cache_revalidate on;            # If-None-Match → the app's cheap 304
  proxy_cache_use_stale updating error timeout;
  proxy_cache_lock   on;
  add_header         X-Cache-Status $upstream_cache_status always;
}
```

The proxy must still pass the app's client-IP header (`JADARAT_CLIENT_IP_HEADER`) so the per-client limit applies; behind a cache only misses reach the limiter.

**Removed images in other people's caches.** Replacing or removing an image deletes its copy at once: our side answers `404` for it (after at most a day in a browser or CDN cache that does not revalidate). Copies already taken by **others** cannot be recalled: mail clients' image proxies (Gmail, Outlook) and archived e-mails keep the logo they fetched for as long as they choose. Treat a published image as public for good — never put anything confidential in a logo, favicon or sign-in picture.

## 4. Colours

- The page shows a colour picker, a hex field and preset pairs (Jadarat first; teal, navy, burgundy, plum, forest, charcoal — one hue each). «Use gradient» off stores the primary colour twice and the current menu item and main buttons use it alone.
- **Contrast check** (`checkBrandContrast`): white text on the primary colour, on the secondary colour (with the gradient), and the primary colour as text on white, against WCAG 2.2 AA 4.5 : 1, with the real ratio. A failure is a **warning** — the admin may save; the product then uses a darker shade where text sits on the colour (`deriveOrganizationBrand`: every pair re-checked, docs/design/theming.md §3).
- Stored: `#RRGGBB` (upper case) or nothing (the Jadarat look — the Jadarat preset with the gradient stores nothing, so it equals the shipped theme). The e-mail button and link colours are derived at save time (`emailBrandColors`) and stored with the branding: the worker renders e-mails without theme code (theming.md §6 point 1).
- Applied: the shell and the sign-in page render the brand layer (`brandLayerCss`: only `#RRGGBB` values of known roles) in a `<style>` with the request's CSP nonce; the live preview sets the unsaved values as CSS custom properties on its own box through the CSSOM (style attributes are blocked by the CSP).
- After a save, `revalidatePath('/', 'layout')` and a refresh: the whole organization sees the new look at once.

## 5. Where the look applies

| Place | What |
|---|---|
| App shell | colours (menu's current item gradient, buttons, accents, summary cards), logo in the logo area (name wordmark without one) |
| Browser tab | favicon on every suite page (`[locale]/suite/layout.tsx` metadata) and every page before the suite; Jadarat's `app/icon.svg` otherwise |
| Sign-in page | colours, logo, sign-in picture under the gradient; «Powered by ENTLAQA» stays. Organization: the address's **subdomain** (authoritative, as Kawadir), else the organization this browser last worked in (`jadarat_brand` cookie: the slug, display only — a tampered value can only show another organization's public look); custom domains come with FR-ADM-10 (R2) |
| Other pages before the suite | sign-up (invitation code), forgot / reset password, invitation links, the sign-in code pages (`/mfa`, `/mfa/remove`): the same colours, favicon and logo (picture where the frame has the panel), found the same way as on the sign-in page (`components/auth/auth-brand-layout.tsx` as their `layout.tsx`) |
| E-mails | logo in the header (alt: the organization's name), button and link colour, a thin accent line (`renderEmail(…, brand)`, `queueEmail` reads it in the job's tenant transaction) |

**The brand cookie survives signing out.** `jadarat_brand` (the organization's slug, not secret, no session data) is kept on purpose when the user signs out: the next sign-in on that browser shows the same organization's look, as Kawadir does. On a shared computer the next person therefore sees that organization's logo and colours on the sign-in page (never any of its data); working in another organization on that browser replaces the cookie, and clearing the browser's site data removes it.

## 6. Expand-first

The app and the worker deploy in parallel with the database: every read asks the catalog first (`brandingExists`, cached once true) and answers «the Jadarat look» before the migrations; the public reads return nothing (`42883` → null); the General page keeps working with or without names in its input.
