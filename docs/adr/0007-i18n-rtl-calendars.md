# ADR 0007 — Internationalization, RTL, Hijri and working calendars, prayer times

**Status:** Accepted — PR #9, 30 Sep 2026 · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B07 · **Related:** BRD §13 (NFR-L10N-01…13), FR-SCH-05/06/07, FR-ADM-04, BR-ADM-3, FR-NTF-07, FR-CAT-10, FR-CRT-01/02, FR-DEP-05, DR-2, DR-3, Appendix H.1/H.2; Development Plan §9; ADR 0001, ADR 0006, ADR 0008

## Context

- Arabic is the default language and RTL is non-negotiable; English is a peer language, not the source (Plan §9). Government tenants may run Arabic-only (NFR-L10N-12).
- Dates must be shown in Gregorian, Hijri (Umm al-Qura) or dual form per tenant/user (FR-SCH-07, R1) — in UI, PDFs (certificates) and e-mails — while storage stays calendar-neutral (DR-2).
- Scheduling and notifications depend on working weeks per branch (incl. half-days), public holidays incl. Hijri-based holidays confirmed by moon sighting, and prayer times per location (quiet hours in FR-NTF-07 are R1; scheduling warnings in FR-SCH-06 are R2).
- Sovereign deployments forbid runtime dependencies on third-party APIs that are not available in-country (BRD §15).

## Options considered

- **i18n library:** next-intl (App Router support, ICU messages, locale routing — BRD H.1) vs. react-i18next / Lingui. next-intl chosen by BRD; no reason to deviate.
- **Hijri:** (a) `Intl.DateTimeFormat` with `islamic-umalqura` for formatting + our own conversion table; (b) a third-party Hijri library only; (c) `Temporal` with non-ISO calendars (native support is still uneven across the browsers in NFR-COMP-01 and Node 24 — verify at implementation; polyfills exist).
- **Prayer times:** (a) local calculation library (`adhan` / adhan-js, MIT); (b) an online API (e.g., Aladhan) with caching — rejected: runtime third-party dependency, not in-country.

## Decision

### 1. Locales and routing
- next-intl with locales `ar` (default) and `en`, **always-prefixed** routes (`/ar/...`, `/en/...`). The request proxy composes next-intl's locale handling with tenant resolution (ADR 0002 §4); protected paths are matched on real URL prefixes (CLAUDE.md).
- Locale resolution: URL → user preference → tenant default → `ar`. For **Arabic-only tenants** the proxy redirects `/en/*` to `/ar/*` and the language switcher is hidden (FR-DEP-05).
- `<html lang dir>` is set per locale in the root `[locale]` layout; all server-rendered e-mails and PDFs set `dir`/`lang` explicitly.
- Formatting locales carry explicit Unicode extensions, e.g. `ar-SA-u-nu-latn-ca-gregory`; code never relies on a runtime's default numbering system or calendar for `ar` (they differ between CLDR versions and regional variants).

### 2. Message catalogs and glossary
- ICU MessageFormat JSON catalogs per package/module: `packages/platform-i18n/messages/{ar,en}/*.json` (shell, platform) and `modules/<module>/messages/{ar,en}/*.json`, merged per request by namespace. Arabic plural categories (`zero, one, two, few, many, other`) are required wherever a count is formatted.
- **Ownership:** Arabic copy is authored by the UX writer (role held by a Claude agent, approved by the PO) against the glossary `docs/design/content/glossary.md` (T-M1-A06); English is written in parallel, not translated from code identifiers. Before GA, released Arabic UI is reviewed by a professional translator/reviewer (NFR-L10N-13, human-only activity). No machine-only translation is merged: new keys are added in both languages in the same PR.
- CI: missing/extra keys between `ar` and `en`, invalid ICU syntax, missing Arabic plural forms and glossary term violations (a lint of forbidden variants) fail the build.
- Tenant terminology overrides (ADM-12, R2) are applied as a message layer on top of catalogs, keyed by glossary term, never by editing catalogs.

### 3. RTL and bidirectional text
- Tailwind **logical** utilities only (`ms-/me-`, `ps-/pe-`, `start-/end-`, `text-start/end`, `border-s/e`, `rounded-s/e`); physical left/right utilities and CSS properties are blocked by lint (ESLint Tailwind rule + Stylelint) with an explicit allow-list (e.g., charts, media players).
- Directional icons are mirrored in RTL (`rtl:-scale-x-100`); non-directional icons are not.
- User-generated and mixed content is isolated: `dir="auto"` on inputs and free text, `<bdi>` for names/codes inside sentences, and forced `dir="ltr"` for e-mails, URLs, phone numbers, course/session codes and IBANs.
- Storybook stories and Playwright visual tests run in both directions (Plan §5).

### 4. Fonts
Self-hosted with `next/font/local` (no runtime or build-time call to Google Fonts, so builds work in air-gapped CI): IBM Plex Sans Arabic + IBM Plex Sans (+ Plex Mono) as in `docs/design/tokens` (SIL OFL). Arabic base size +10–15 %, line-height 1.5–1.7, no synthetic italics (NFR-L10N-02). Tenant brand fonts (ADM-07) come from an approved, licence-checked list shipped with the app. The same font files are used by the PDF renderer.

### 5. Numerals and inputs
- Display: Western (`latn`) or Eastern Arabic (`arab`) digits per tenant default and user preference (NFR-L10N-03), applied through one formatting module (`platform-i18n/format`) used by UI, e-mail, WhatsApp/SMS text and PDFs.
- Input: all numeric/date/phone inputs accept Western, Eastern Arabic (`٠–٩`) and Persian (`۰–۹`) digits and Arabic decimal/thousands separators; a shared zod preprocessor normalizes to ASCII before validation.
- Currency formatting uses ISO 4217 minor units (3 decimals for OMR/BHD/KWD — NFR-L10N-09).

### 6. Hijri calendar and date display
- **Storage:** instants as `timestamptz` (UTC); date-only values as `date` (ISO/Gregorian); wall-clock schedules with an IANA timezone (`Asia/Riyadh`, `Asia/Dubai`, `Africa/Cairo` — Egypt observes DST, so offsets are never stored instead of zones).
- **Formatting:** `Intl.DateTimeFormat` with `calendar: 'islamic-umalqura'` (available in Node with full ICU and in the target browsers; ICU's Umm al-Qura table covers roughly 1300–1600 AH — verify bounds).
- **Conversion Hijri ↔ Gregorian** (Hijri date pickers, Hijri-based holidays, Hijri certificate numbering years in CRT-02): `platform-i18n/hijri` uses a **generated month-start table** (built from ICU at build time, committed, and unit-tested against published Umm al-Qura dates for sample years) so server, browser and PDF produce identical results regardless of runtime ICU version. `Temporal` may replace the table once natively available on all targets.
- **Display modes:** `gregorian`, `hijri`, `dual` (primary + secondary line) via one `<DateDisplay>` component and one text formatter; resolution user → tenant; certificates and reports have their own configurable mode (FR-CRT-01, NFR-L10N-04). Date pickers support both calendars.

### 7. Working weeks, holidays, Ramadan
- `platform.working_calendars` hold a weekly pattern per weekday as a list of working intervals (half-days = shorter intervals, e.g., Friday 07:30–12:00). Resolution order (BR-ADM-3): branch → legal entity (R3) → tenant → country default. Country defaults (NFR-L10N-06) are global reference data maintained by ENTLAQA.
- Public holidays: global reference per country (`platform.ref_public_holidays`) + tenant/branch additions (`platform.holidays`). Hijri-based holidays store the Hijri rule (month/day/length); their Gregorian dates are **computed as tentative** from Umm al-Qura and become **confirmed** only when an admin (ENTLAQA for reference data, or the Tenant Admin for tenant overrides) confirms the moon-sighting dates (NFR-L10N-07); tenants are notified to confirm. Tentative holidays produce soft conflicts only. Holiday names and lengths are regulatory content: seeded only from legally validated sources.
- **Ramadan mode:** a dated calendar override (period from Hijri month 9, tentative → confirmed like holidays) with reduced working intervals per branch; consumed by conflict detection and quiet hours; iftar-aware scheduling and catering are R2 (FR-SCH-06, FR-LOG-04).

### 8. Prayer times
- Calculated locally with **`adhan`** (adhan-js) — no network call. Inputs: coordinates of the venue (RES-01), else branch, else tenant city; IANA timezone; method per country (defaults: KSA `UmmAlQura`, UAE `Dubai`, Egypt `Egyptian`, Qatar `Qatar`, Kuwait `Kuwait`, others `MuslimWorldLeague`; tenant-overridable); Asr juristic method configurable (Shafi default, Hanafi option). Umm al-Qura's longer Isha interval in Ramadan must be applied if the library does not (verify).
- Prayer windows = adhan time + configurable duration (default 20 min; Jumu'ah block default 11:30–13:30 local on Friday, configurable per branch).
- R1 use: notification quiet hours (FR-NTF-07, ADR 0008). R2 use: scheduling warnings and agenda breaks (FR-SCH-06). Results are cached per (location rounded to ~1 km, date, method).

### 9. Arabic search normalization
`platform-i18n/text` provides one normalization function (remove tashkeel and tatweel; unify alef forms → ا, ى → ي, ة → ه; normalize digits) used both in the application and in an equivalent immutable SQL function `private.normalize_ar(text)` for generated search columns and trigram indexes (FR-CAT-10, NFR-L10N-05). Parity between the two is unit-tested with a shared fixture list; stemming beyond normalization is decided in the M3 catalog-search spike.

## Consequences

**Positive:** one formatting path for all surfaces; deterministic Hijri conversion; no runtime third-party calls; RTL correctness enforced by lint instead of review.

**Negative / costs:** the Hijri table must be regenerated/extended when ICU updates its Umm al-Qura data (tracked by a test); holiday confirmation is an operational duty for ENTLAQA each year; locale-prefixed URLs everywhere (including e-mail deep links).

## Security impact
Low. Input normalization reduces validation bypass via alternative digits; `dir` isolation prevents bidi spoofing of codes/URLs in the UI (Trojan-source-style display tricks); template variables in PDFs/e-mails are escaped (ADR 0008).

## Sovereign deployment impact
Fully offline-capable: fonts, catalogs, Hijri table and prayer-time calculation ship with the build; no external API.

## Suite impact
`platform-i18n` (formatting, Hijri, calendars, prayer times, normalization) and the working/holiday calendars are shared by Core HR, Payroll & Time (attendance, leave) and other modules.

## Verification
1. Unit tests: Hijri table vs. published Umm al-Qura samples and vs. `Intl` for 1440–1500 AH; digit normalization; `normalize_ar` app/SQL parity.
2. Prayer-time tests against reference values for Riyadh, Jeddah, Dubai, Cairo (tolerance ±2 min).
3. CI catalog checks (keys, ICU, plurals, glossary) and logical-property lint.
4. Playwright: Arabic RTL and English LTR screenshots per critical journey; Arabic-only tenant cannot reach `/en`.
