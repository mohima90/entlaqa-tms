# Branding: the organization's look (runbook)

> Backlog: **WP-ADM-02** (T-M2-23, T-M2-49) · Requirements: FR-ADM-07, FR-ADM-02 (names), FR-NTF-02 (brand part of e-mails) · Business flow: `docs/business-flows/EP-BRAND-branding.md` (agreed 20 Oct 2026) · Kawadir ATS `/org/branding`

The Organization Admin gives the product the organization's look: names (English, Arabic), logo, favicon, sign-in page picture, primary + secondary colour with «Use gradient», website. Until then — and after «Reset to the Jadarat look» — the shipped Jadarat theme applies (slate `#2F4858` → steel `#33658A`).

| Piece | Where |
|---|---|
| Tables, image rules, publishing and public functions | migrations `20261023100000`–`20261023100300` (`platform.file_purposes` rows, `platform.brand_assets`, `platform.tenant_branding`, `private.*brand*` functions owned by `file_guard`) |
| Page | `apps/suite/src/app/[locale]/suite/admin/branding/page.tsx`, `components/branding/branding-form.tsx` |
| Actions and definitions | `apps/suite/src/actions/organization.ts`; `packages/platform-rbac/src/iam/branding.ts` (with the app's file service `lib/branding-files.ts` and colour deriver `lib/branding-view.ts`) |
| Colours, presets, contrast | `packages/ui/src/theme/branding.ts` (+ `organization-brand.ts`, `gradient` option) |
| Where the look applies | shell `components/suite-shell.tsx` + `components/branding/brand-style.tsx`; favicon `app/[locale]/suite/layout.tsx`; sign-in page `app/[locale]/sign-in/page.tsx` + `lib/sign-in-brand.ts`; e-mails `packages/platform-notifications/src/layout.ts` |
| Public images | `apps/suite/src/app/api/brand/[asset]/route.ts` (`lib/brand-asset-route.ts`) |
| Worker | `packages/platform-files/src/jobs/brand-assets.ts` (platform task `platform.brand_assets`) |
| Tests | pgTAP `supabase/tests/99_branding_*.sql` (+ 00, 10, 20, 80); unit tests next to the code; E2E `apps/suite/e2e/branding.spec.ts` |

## 1. Who

| Who | Page | Save, upload |
|---|---|---|
| Organization Admin (`platform.tenant.manage`, organization-wide; `organization_only` in the catalogue — never in custom roles) | edits | yes (high risk: the session is confirmed with Auth) |
| A reader of the organization's settings (`platform.tenant.read`, e.g. an Auditor custom role) | read only | no |
| Everyone else (HR Manager, L&D Manager, Learner, …) | refused | no |

The database enforces the same: `tenant_branding_insert` / `_update` policies call `private.actor_may_manage_tenant` (permission-based), the names go through `tenants_update`. Every change is audited (`platform.tenant.branding_changed`: changed fields, before → after; images by **file id**, never their name or content).

## 2. Images

1. The page checks the name (`.png`, `.jpg`/`.jpeg`, `.webp`), the size (logo 2 MB, favicon 500 KB, sign-in picture 5 MB) and the first bytes (PNG/JPEG/WebP signature; SVG, GIF, HTML refused) and shows the picked file in the previews at once (`blob:`).
2. Upload through platform-files (ADR 0006, `docs/engineering/files.md`): reservation in the action's transaction (purposes `platform.brand_logo`, `platform.brand_favicon`, `platform.brand_sign_in_image`, owner `platform/tenant_branding/<tenant>`), signed URL after the commit, browser `PUT`, confirmation, **malware scan and type check by content** in the worker. The page polls the status.
3. Save references the file. The trigger `tenant_branding_files` accepts only the **saver's own** confirmed upload (`uploaded`, `scanning` or `clean`) of the slot's purpose for this organization (`JB001` otherwise); a **replaced or removed** image is released at once (its public copy deleted, the file marked deleted → purged by housekeeping after 30 days); the saver's other unused branding uploads, and anyone's older than a day, are released too.
4. The worker's task `platform.brand_assets` (each pass) publishes images that are in use **and clean**: it reads the scanned file (stream checked against the scan's size and SHA-256), checks the type by content once more, and stores a copy (`private.publish_brand_asset`: same size and SHA-256 again, still in use). Until then the Jadarat image is shown (hosted: the scan runs in the 5-minute Jobs pass with `FILE_SCANNING=on`).

Not done (follow-up): re-encoding images and removing their metadata (EXIF) with `sharp` — ADR 0006 §3 asks for it; needs the PO's acceptance of `sharp`/libvips (LGPL-3.0), as for profile photos (files.md §8).

## 3. Serving images without a session — the design

The sign-in page (before anyone signs in), the browser tab and **mail clients** need the images without a session; uploaded files must stay private (no public bucket, no long-lived Storage links, no Storage key in the web app — ADR 0006).

**Choice: a published copy in PostgreSQL, served by the app at `/api/brand/<id>`.**

| Property | How |
|---|---|
| Only safe content public | only images the scan found **clean**, re-checked by content (PNG/JPEG/WebP), copied when the bytes equal the scanned ones |
| Not listable | no index or listing route; `<id>` is a random UUID (122 random bits), not the file id; the only reader is `private.public_brand_asset(id)` (claim-less `app_server` transaction) |
| Per tenant, revocable | a copy is served only while its organization is in service (`trial`/`active`) and its Branding still uses that image; replacing or removing an image deletes its copy at once |
| Browser safety | `Content-Type` = the detected type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: default-src 'none'; sandbox` |
| Caching | `Cache-Control: public, max-age=31536000, immutable` and `ETag` = SHA-256 (a new image gets a new id) |
| E-mail clients | `Cross-Origin-Resource-Policy: cross-origin` for `/api/brand/*` only (next.config.ts); the e-mail links `${APP_BASE_URL}/api/brand/<id>` |
| CSP of our pages | same origin: `img-src 'self'` holds; previews of picked files use `blob:` (already allowed) |
| Sovereign | plain PostgreSQL + the app; the same on hosted Supabase and self-hosted (no Storage public bucket, no gateway change) |

Alternatives not chosen: a public Storage bucket (vendor feature, listing and policy risk, another origin in the CSP, gateway changes self-hosted); long-lived signed URLs (hosted Storage cannot bound them per tenant or revoke them, see files.md §6 RR-FIL-01). Size: at most 7.5 MB per organization in the database (2 + 0.5 + 5 MB).

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
| Browser tab | favicon on every suite page (`[locale]/suite/layout.tsx` metadata) and the sign-in page; Jadarat's `app/icon.svg` otherwise |
| Sign-in page | colours, logo, sign-in picture under the gradient; «Powered by ENTLAQA» stays. Organization: the address's **subdomain** (authoritative, as Kawadir), else the organization this browser last worked in (`jadarat_brand` cookie: the slug, display only — a tampered value can only show another organization's public look); custom domains come with FR-ADM-10 (R2) |
| E-mails | logo in the header (alt: the organization's name), button and link colour, a thin accent line (`renderEmail(…, brand)`, `queueEmail` reads it in the job's tenant transaction) |

## 6. Expand-first

The app and the worker deploy in parallel with the database: every read asks the catalog first (`brandingExists`, cached once true) and answers «the Jadarat look» before the migrations; the public reads return nothing (`42883` → null); the General page keeps working with or without names in its input.
