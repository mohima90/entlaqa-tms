# M2 — Organization profile screen (approved, built)

> **Status:** Approved by the PO on 14 Oct 2026 (design canvas «Organization Admin · Organization profile», English + Arabic) · **Built in T-M2-22** · Role: Organization Admin ([organization-admin.md](../../../delivery/roles/organization-admin.md) #3, #4)
> **Requirements:** FR-ADM-02 (profile), FR-SCH-07 (Gregorian / Hijri / both), BR-ADM-3 (working week resolution), BR-IAM-3 style audit · **Code:** `apps/suite/src/app/[locale]/suite/admin/organization/page.tsx`, `apps/suite/src/components/organization/organization-profile-form.tsx`; data: `platform.tenant_settings` (data model §2.1)
> **Source:** the PO's private design canvas. The mock-ups are not copied into the repository; this note records what the build follows.

## Where and who

- Route `/{ar|en}/suite/admin/organization`; menu **Organization → Organization profile** («المنشأة ← بيانات المنشأة»), a link for the Organization Admin (organization-wide `platform.tenant.manage`) instead of «قريبًا» / "Coming soon"; also on the set-up home.
- Everyone else (HR Manager, Auditor, Learner, …) gets «ليست لديك صلاحية لتنفيذ هذا الإجراء.» / "You don't have permission to do this." — no read-only view (PO, 14 Oct 2026; Appendix B gives the Auditor "V" on tenant settings — see open point 1).
- Saving needs an authenticator code from the last 15 minutes (`platform.tenant.manage` is high risk / AAL2 in the permission registry, as the security policy). At AAL1 the page shows a warning with «التحقق بتطبيق المصادقة» / "Verify with the authenticator app" and the form read-only; a save refused for a stale code says so and links to the code (nothing typed is lost).

## Layout (as the mock-up)

Breadcrumb «المنشأة / بيانات المنشأة», H1, one intro line; two columns that stack below ~900 px: three cards and two notes; a sticky footer.

| Card | Fields | Rules |
|---|---|---|
| **المنشأة / Organization** | Display name (English), Display name (Arabic), Industry, Country | Names required, trimmed, ≤ 80 characters (`dir` fixed per field). Industry: fixed list of 15 (labels in the catalogs). Country: ISO 3166-1 alpha-2 names from `Intl.DisplayNames` in the UI language (no hand-typed list); "Choose…" until set |
| **الإعدادات الافتراضية / Defaults** | Currency, Timezone, Fiscal year starts in, Default language | Currency: ISO 4217 from `Intl.supportedValuesOf('currency')` as «SAR — ريال سعودي». Timezone: IANA zones sorted by UTC offset, «الرياض (UTC+03:00)» (Arabic city names for the region's zones, otherwise the IANA city). Month names Gregorian. Language: English / العربية radios (fieldset + legend) |
| **التقويم وأسبوع العمل / Calendar & working week** | Date display, Working days, Working hours start / end | Date display: Gregorian / Hijri (Umm al-Qura) / Both radios with a live preview of today in the chosen mode. Days: seven toggle buttons (`aria-pressed`, full day name as accessible name, 44 px), at least one. Hours: `HH:MM` 24-hour text fields (Eastern Arabic digits accepted), end after start. Note: branches can have their own week and hours (set by HR) |

Notes: «الدولة تملأ الباقي» / "Country fills in the rest" and «بيانات لا نطلبها» / "Not collected" (no legal or registration data). Footer: «آخر تعديل: {name} · {date}» / "Last changed by {name} · {date}" (the date in the organization's own display) or "Not changed since your organization was set up.", **Cancel** (back to the saved values) and **Save changes**.

## Behaviour

- **Country presets** (suggestions, applied only when the admin *changes* the country — never on load, never saved without "Save"; a polite status line says they were filled in): SA → SAR, Asia/Riyadh, Sun–Thu, Both · AE → AED, Asia/Dubai, Mon–Fri, Gregorian · EG → EGP, Africa/Cairo · KW → KWD, Asia/Kuwait · QA → QAR, Asia/Qatar · BH → BHD, Asia/Bahrain · OM → OMR, Asia/Muscat · JO → JOD, Asia/Amman (Sun–Thu, Gregorian). Other countries: the currency when exactly one ISO 4217 code starts with the country code, the time zone when the country has exactly one; nothing else changes. Hours stay as they are (default 08:00–16:00). Code: `packages/platform-i18n/src/regional-presets.ts` (unit-tested).
- **Validation:** in the form first (field messages under each field, `aria-invalid` + `aria-describedby`, a summary alert), then by the action (zod, codes on offer on the server) and the database (checks, trigger). Values are kept on any error.
- **Audit:** `platform.tenant.profile_changed` with the changed fields and their values before and after; no audit row when nothing changed ("There are no changes to save.").

## Effects elsewhere

- The organization name in the menu is the display name in the UI language (the other one when empty).
- Dates across the app (users list "Last sign-in", invitation dates, user profile and its audit trail, sign-in sessions, "last changed" lines, recent imports) follow the date display and the organization's time zone: e.g. "Oct 14, 2026, 2:05 PM · Jumada I 3, 1448 AH" (Both) or «3 جمادى الأولى 1448 هـ في 2:05 م» (Hijri). One formatter: `formatDisplayDate` in `platform-i18n`.
- New people get the default language unless one is given: the invite form preselects it; a bulk import row without a language uses it (a re-invited person keeps theirs).

## New Arabic strings (for the UX writer's review)

All under `organizationProfile.*` in `packages/platform-i18n/messages/ar.json`. The mock-up's copy is used as approved; strings the mock-up did not show and were written for the build: `notConfigured`, `stepUp`, `stepUpAgain`, `organization.industryChoose`, `organization.countryChoose`, `calendar.preview` («تاريخ اليوم كما سيظهر»), `calendar.hoursHint`, `presetApplied` («عبّأنا الاقتراحات الخاصة بـ{country}. راجعها ثم احفظ.»), `lastChangedDefault`, `saved`, `noChanges`, `fieldErrors.*`, the 15 `industries.*` labels, the Arabic city names of the time zones (`platform-i18n/src/regional.ts`), and the revised `shell.setupBody`.

## Open points

1. Appendix B gives the Auditor "V" on tenant settings; the PO asked for the page to refuse the Auditor. A read-only view for the Auditor can be added later if wanted.
2. The working-days hint promises a warning for sessions on other days: sessions are not built yet (M3); the warning comes with scheduling.
3. BR-ADM-2 (currency change after transactions needs a conversion confirmation) is not enforced yet: no amounts exist until the finance features.
