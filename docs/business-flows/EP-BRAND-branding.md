# Business flow — Branding (the organization's look)

| | |
|---|---|
| **Work package** | WP-ADM-02 (ROADMAP-by-role) |
| **Requirements** | FR-ADM-07 (Branding page), FR-ADM-02 (names move here from General), FR-NTF-02 (brand part of e-mails) |
| **Status** | **Agreed (PO, 20 Oct 2026)** — the three open questions approved as proposed · **Changed after agreement (20 Oct 2026)**: BR-BRD-b, branding images are no longer virus-scanned (PO decision «B») |
| **Copied from Kawadir** | Kawadir ATS `/org/branding`: company names EN/AR, logo, favicon, login page image, primary + secondary colour with a «use gradient» switch, preset swatches, company website, live preview; Org Admin only; the look applies to the app shell, the sign-in page and e-mails. **Not copied:** tagline and careers-page URL (recruitment-only, and unfinished in Kawadir) |

## 1. Goal
Each organization makes the product look like its own — its names, logo, browser icon, sign-in picture and colours — without asking ENTLAQA. Until it does, the product shows the Jadarat look (slate → steel gradient).

## 2. Actors
| Actor | Role | What they do |
|---|---|---|
| Organization Admin | Standard (set-up) | Edits the Branding page |
| Everyone in the organization | Any | Sees the organization's look in the product, the sign-in page and e-mails |

## 3. Step-by-step flow
1. **Organization Admin → Organization → Branding** (Kawadir layout): one page with a live preview.
2. **Names**: the organization's name in English and Arabic (moved here from General settings).
3. **Images**: logo, favicon (the small browser-tab icon) and sign-in page image — upload, replace or remove each.
4. **Colours**: primary and secondary colour (colour picker + hex field + preset swatches, the Jadarat colours first) and a **«Use gradient»** switch (on: the gradient marks the selected menu item and main buttons; off: the primary colour alone).
5. **Website**: the organization's website address.
6. **Preview** shows the menu, a button and the sign-in page with the unsaved choices; a warning appears when a colour combination is hard to read (WCAG 2.2 AA contrast).
7. **Save** → the look applies at once for everyone; **Reset to the Jadarat look** puts the default colours back (images stay unless removed).

## 4. Business rules
- BR-BRD-a: Only the Organization Admin edits branding; every change is in the audit log (who, when, before → after; images by name, not content).
- BR-BRD-b: Images: PNG, JPG or WebP (SVG refused — it can carry scripts); logo ≤ 2 MB, favicon ≤ 500 KB, sign-in image ≤ 5 MB (Kawadir's limits); ~~files are scanned like other uploads~~ **branding images are not virus-scanned; the type is checked by content, the size and the number of pixels are limited and the metadata (e.g. the GPS position of a photo) is removed, and the image shows everywhere as soon as the Branding is saved**; a replaced or removed image is deleted. *Changed after agreement, 20 Oct 2026 — PO, 20 Oct 2026: like Kawadir, branding images are not virus-scanned so they show at once; type by content, size, pixels and metadata removal stay.* Every other upload (imports, profile photos, …) is still scanned.
- BR-BRD-c: Colours are valid hex colours; a contrast below WCAG 2.2 AA is a **warning** (the admin may still save), so text stays readable.
- BR-BRD-d: The product's own fonts are always used (no font choice — PO, 14 Oct 2026).
- BR-BRD-e: Where the look shows: the product's menu and accents, the browser-tab icon, the sign-in page (logo, picture, colours) and the e-mails (logo and colour).

## 5. Exceptions
- An image is too big or of the wrong type → refused with the reason.
- No logo / favicon / picture → the Jadarat one is shown.

## 6. Screens
| # | Screen | Role |
|---|---|---|
| 1 | Organization → Branding (names, images, colours, website, preview) | Organization Admin |

## 7. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| 1 | Copy Kawadir's Branding page as above (without tagline and careers URL)? | **Yes** | Approved (20 Oct 2026) |
| 2 | Improvements over Kawadir: real contrast warning (BRD), colour picker, image type/size checks without SVG, old images deleted, preview with unsaved choices, favicon used everywhere, «Reset to the Jadarat look» | **Yes** | Approved (20 Oct 2026) |
| 3 | Who edits branding? | **Organization Admin only** (Kawadir) | Approved (20 Oct 2026) |
