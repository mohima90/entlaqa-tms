# Jadarat Design Principles & Arabic-First Rules (v1)

| | |
|---|---|
| **Backlog** | T-M1-A01 (design principles & Arabic-first tokens) |
| **Applies to** | Jadarat Platform shell and every suite module, starting with Jadarat TMS |
| **Requirements** | NFR-UX-01…04, NFR-L10N-01…13, FR-SCH-07, FR-LRN-08, FR-STE-08, Development Plan §1 (Q3–Q5) and §9 |
| **Status** | Draft v1 — 30 Sep 2026. To be validated in usability round 1 (`research/usability-test-round-1.md`) |
| **Related** | `tokens/tokens.css`, `tokens/tokens.json`, `tokens/contrast-report.md`, `suite-shell.md`, `content/` |

Jadarat is used by people who run training operations for a living (coordinators, training managers), by people who touch it for a minute between other work (line managers, learners, instructors), and by auditors who need to trust what they see. The principles below resolve design trade-offs in that order of stakes. When two principles conflict, the one listed first wins.

---

## 1. Principles

### P1 — Arabic is the original, not the translation
Every screen is designed, written and reviewed in Arabic first; English is a peer language, not the source (Plan §9).
- Layouts are drawn in RTL first. An LTR mock-up is never "flipped" to produce the Arabic one.
- Copy comes from the Arabic UX writer and the glossary (`content/glossary-ar-en.md`), never from machine translation.
- Arabic gets its own type sizes and line-heights (see §3). Strings are allowed to be up to ~30% longer or shorter than English without breaking layout.
- *Test:* if you hide the English build, does the Arabic screen still read as if it was designed on purpose?

### P2 — Clear next step under time pressure
Coordinators work against the clock ("the session starts tomorrow and the room is double-booked"). Every screen answers three questions within one glance: *Where am I? What needs me? What is the one primary action?*
- One primary button per view. Secondary actions are visually quieter; destructive actions are never primary and always offer undo or a confirmation that names the consequence.
- Problems are surfaced where the decision is made (a conflict appears next to the instructor field, with the fix), not in a later error page.
- Progressive disclosure: defaults from templates first, advanced fields behind "More options".
- Target: a new coordinator schedules a multi-day session with a room and instructor in ≤ 10 minutes without training (NFR-UX-03).

### P3 — Calm density
Operational screens show a lot of data; they should feel quiet, not busy.
- Neutral surfaces, one accent (primary), semantic colors reserved for status. Color never carries meaning alone: status also has an icon and a word.
- Tables are the default for lists of more than ~7 items on desktop; they collapse to cards on mobile. Row height 48 px (comfortable) or 40 px (compact, user setting).
- Numbers align in tabular figures; dates use one format per context (see §5).
- Whitespace comes from the 4 px spacing scale, never ad-hoc.

### P4 — Mobile-first for the occasional user
Learners, instructors and line managers mostly meet Jadarat on a phone, often from a WhatsApp link (NFR-UX-02).
- Every learner, instructor and manager flow is designed at 360 px first and must work without horizontal scroll.
- Primary actions sit in the thumb zone (bottom of the screen); bottom navigation for these roles (see `suite-shell.md` §8).
- Touch targets ≥ 44 × 44 px (our standard; WCAG 2.2 SC 2.5.8 minimum is 24 px).
- Approvals in ≤ 2 taps from the notification; QR check-in completes in ≤ 3 s after the scan.

### P5 — Accessible by default (WCAG 2.2 AA, both languages)
Accessibility is a build-time property, not a QA phase (Q5).
- Contrast: text ≥ 4.5:1, UI components and focus ≥ 3:1 — verified for all token pairs (`tokens/contrast-report.md`).
- Every control is keyboard-operable with a visible focus ring (`--focus-ring`); focus is never hidden by sticky headers or bottom bars (SC 2.4.11).
- Semantic HTML first; ARIA only to fill gaps. Status changes (saved, approved, check-in result) are announced through `aria-live` regions.
- Screen-reader labels are written in both languages by the UX writer, not generated from English keys.
- No drag-only interactions (SC 2.5.7): calendar drag-and-drop always has a menu or form equivalent.
- Motion respects `prefers-reduced-motion`; nothing flashes.
- Authentication does not rely on cognitive tests (SC 3.3.8); OTP fields accept paste and autofill.

### P6 — Trust is visible
Training records are evidence for regulators, auditors and payroll. Users must be able to see *why* the system says something and *who* changed it.
- Every computed status (compliance, completion, conflict) links to its reason ("Overdue: Fire Safety expired 12 Sep 2026").
- Every record shows "Last changed by … on …" and links to its audit trail (AUD-01).
- Irreversible actions (revoke a certificate, delete attendance after the edit window) require a reason that is written to the audit log.
- Public pages (certificate verification) show only what is needed to verify, and say who issued the credential and when it was checked.

### P7 — Bilingual parity
Arabic and English users get the same capability, the same information and the same quality.
- Every user-facing string, template, PDF and notification exists in both languages (NFR-L10N-11); the recipient's locale drives language.
- Bilingual data (course names, job titles, names) is captured in both languages side by side, never "translate later".
- Government tenants can run Arabic-only (NFR-L10N-12): no English fallback may leak into the UI in that mode.

### P8 — One suite, many modules
TMS is the first of several modules. Patterns, not pages, are designed.
- Shell, navigation, inboxes, search, empty/loading/error states and form patterns are shared platform components (`suite-shell.md`).
- No one-off styles: tokens only (Plan §9). A new pattern is proposed for the design system before it ships in a module.

---

## 2. RTL rules

### 2.1 Layout
| Rule | Detail |
|---|---|
| Logical properties only | Use `margin-inline-start`, `padding-inline-end`, `inset-inline-start`, `border-start-start-radius`, `text-align: start`. **Never** `left`/`right` in component CSS. Tailwind: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`. Lint rule to block physical properties in `packages/ui`. |
| Direction source | `dir` and `lang` are set on `<html>` from the user's locale. Components never hard-code direction. Portals (menus, toasts, dialogs) inherit `dir`. |
| Reading order | In RTL, the start edge is the right. Side navigation sits on the right, the primary content flows right-to-left, the "next" button sits at the inline-end (left) of a wizard footer. |
| Flex / grid | `flex-direction: row` already follows `dir`. Do not use `row-reverse` to "fix" RTL. |
| Transforms and animations | Physical transforms (`translateX`) do not flip. Multiply by a direction variable (`--dir: 1` / `-1`) or use logical keyframes. Drawers slide in from the inline-start edge. |
| Scroll & carousels | Horizontal scroll starts at the inline-start edge. Carousels advance toward the inline-end. |
| Progress & sliders | Fill from the inline-start edge (right in Arabic). |
| Charts | Category axes run right-to-left in Arabic; **time axes also run right-to-left** in Arabic (confirm in usability round 1 with managers; configurable per chart if needed). Numeric value axes stay bottom-to-top. |
| Tables | Column order follows reading order: identity column first (at the right in Arabic), actions last. Numeric columns align to the inline-end so digits line up. |

### 2.2 Icon mirroring
Mirror an icon when it represents **direction in reading order or time flow**. Do not mirror icons that represent **real-world objects, clocks, or media controls**.

| Mirror in RTL | Do **not** mirror |
|---|---|
| Back / forward arrows, chevrons in breadcrumbs, pagination, "next step" | Search (magnifier), bell, user, settings gear |
| Send (paper plane) and reply arrows | Clock, timer, history clock (clocks turn clockwise everywhere) |
| Undo / redo (swap meaning with position) | Checkmark, close (×), plus, minus |
| List with bullets / text-align icons, indent / outdent | QR code, camera, calendar, location pin, phone |
| Sidebar open/close ("panel at start") | Media play/pause/skip (follow the media timeline convention, which stays LTR) |
| Progress/steppers, "external link" arrow | Download / upload (vertical), refresh |
| Log out / sign in (door + arrow) | Brand logos, flags, charts' data marks |
| Help "?" in Arabic uses the Arabic question mark ؟ glyph only in text, not in the icon | Checkboxes, radio buttons, toggles (toggle "on" knob sits at the inline-end) |

Implementation: icons that mirror get `class="icon--mirror"` (CSS: `[dir="rtl"] .icon--mirror { transform: scaleX(-1); }`). The icon set's metadata records `mirror: true|false` so engineers never decide ad hoc.

### 2.3 Numerals
- Default: Western Arabic digits (0–9) in both languages — the prevailing convention in Gulf and Egyptian enterprise software, and unambiguous next to Latin codes.
- Tenant/user setting: Eastern Arabic digits (٠–٩) in Arabic UI (NFR-L10N-03). The setting must apply consistently to UI, PDF, e-mail, WhatsApp and certificates.
- **Never convert** digits inside identifiers: course and session codes (`LEAD-101-2026-004`), certificate numbers, e-mail addresses, phone numbers, IBANs, national ID/Iqama numbers, URLs. Mark them as identifiers (`data-keep-digits`) in the UI layer.
- Use `Intl.NumberFormat` with the locale (e.g., `ar-SA-u-nu-latn` or `ar-SA-u-nu-arab`), never string replacement in business logic.
- Tabular figures (`font-variant-numeric: tabular-nums`) in tables, KPIs and timers.
- Arabic plural rules: use ICU plural categories (zero, one, two, few, many, other): "يوم واحد، يومان، 3 أيام، 11 يومًا، 100 يوم".

### 2.4 Bidirectional (mixed Arabic/English) text
| Situation | Rule |
|---|---|
| Codes, e-mails, URLs, phone numbers inside Arabic text | Wrap in `<bdi dir="ltr">` (or `<span dir="ltr">` + `unicode-bidi: isolate`) so punctuation does not jump: `رمز الجلسة ‎LEAD-101-2026-004‎`. |
| User-generated names that may be Latin (e.g., "John Smith" in an Arabic list) | Render inside `<bdi>` with no `dir`, letting the browser detect direction per item. |
| Input fields for codes, e-mail, phone, URLs | `dir="ltr"` and `inputmode` set; alignment follows the field's start in the page (`text-align: start` with `dir="ltr"` on the input is acceptable; do not right-align an LTR value inside a left-aligned box). |
| Free-text inputs (notes, justification) | `dir="auto"` so Arabic and English both type naturally. |
| Phone numbers | Always LTR, with country code: `+966 55 123 4567`, `+20 10 1234 5678`. |
| Times with Latin AM/PM in Arabic | Do not mix; Arabic uses ص / م ("9:00 ص"). |
| Punctuation | Arabic comma (،), semicolon (؛) and question mark (؟) in Arabic text; Latin punctuation inside Latin runs. |
| Truncation | Use `text-overflow: ellipsis` on the logical end; never truncate identifiers — wrap them. |
| Currency | Symbol placement follows locale (§5.3). |

### 2.5 Typography (Arabic and Latin)
- Font stacks (tokens `--font-family-arabic`, `--font-family-latin`): **IBM Plex Sans Arabic** for Arabic, **IBM Plex Sans** for Latin — a matched family, so mixed AR/EN lines share weight and x-height rhythm. Fallbacks: Noto Sans Arabic, Noto Kufi Arabic, Segoe UI, Tahoma, Geeza Pro, system-ui. Licensing: both are SIL Open Font License; confirm with ENTLAQA legal and self-host in sovereign deployments (open item in `README.md`).
- Arabic sizes are 10–15% larger than Latin for the same role (tokens `--font-size-arabic-*`: base 18 px vs 16 px). The active scale switches automatically with `lang`.
- Line-height: Arabic body 1.7, headings 1.45; Latin body 1.5, headings 1.25 (NFR-L10N-02).
- **No letter-spacing on Arabic** (it breaks cursive joining) and **no synthetic italics or oblique** for Arabic; emphasize with weight (500/600) or color.
- No uppercase transforms on labels that may contain Arabic; `--letter-spacing-caps` is 0 for Arabic.
- Minimum body size on mobile: 16 px Latin / 18 px Arabic for running text; 13.5 px Arabic minimum for captions.
- Avoid Arabic text in all-bold paragraphs; use semibold for headings only.
- Diacritics (tashkeel) only where they remove real ambiguity (e.g., «مُعتمَد» vs «مُعتمِد»); never on every word.

---

## 3. Hijri / Gregorian date display

Storage is always UTC and calendar-neutral (NFR-L10N-04); display follows the tenant default and the user's preference: **Gregorian**, **Hijri (Umm al-Qura)** or **dual** (FR-SCH-07).

| Context | Dual mode (default for KSA tenants) | Single-calendar mode |
|---|---|---|
| Tables, lists | Primary calendar only, with the secondary in a tooltip/second line on hover/focus to protect density: `الأحد 1 نوفمبر 2026` / `٢١ جمادى الأولى ١٤٤٨ هـ` | Primary only |
| Detail pages, session headers | Both on one line: `الأحد 1 نوفمبر 2026 · 21 جمادى الأولى 1448 هـ` | Primary only |
| Date pickers | Grid in the primary calendar; the other calendar's date shown in small text under each day number and in the field summary | Primary only |
| Certificates, official reports | Both, as configured on the template (FR-CRT-01) | As configured |
| Notifications (WhatsApp/SMS) | Primary calendar + day name (short messages must stay under length limits) | Primary |
| Relative time | "Today, 9:00 AM", "in 3 days", "2 hours ago" for ≤ 7 days; absolute dates beyond that | Same |

Rules
- Always show the **weekday** with session dates — people plan by weekday; working weeks differ per country (Fri–Sat vs Sat–Sun, NFR-L10N-06).
- Hijri month names in full (محرم … ذو الحجة); suffix «هـ» for Hijri and «م» for Gregorian only when both appear or when ambiguous.
- Gregorian months use the names common in Gulf and Egyptian MSA: يناير، فبراير، مارس، أبريل، مايو، يونيو، يوليو، أغسطس، سبتمبر، أكتوبر، نوفمبر، ديسمبر.
- English Hijri: `21 Jumada I 1448 AH`.
- Times: 12-hour with ص / م in Arabic, AM/PM in English by default; 24-hour as a user preference. Show the time zone only when the session time zone differs from the user's.
- Date ranges collapse shared parts: `1–3 نوفمبر 2026`; across months `30 نوفمبر – 2 ديسمبر 2026`.
- Hijri dates are computed with `Intl.DateTimeFormat(locale + '-u-ca-islamic-umalqura')` (ADR 7). Eid holidays remain admin-confirmed (NFR-L10N-07).

---

## 4. Form patterns

### 4.1 General
- One column on mobile; up to two columns on desktop only for short, related fields (date + time, first + family name).
- Labels above fields (never placeholder-only labels). Required fields marked with «(مطلوب)» / "(required)" text, not only an asterisk; optional fields are the exception and are marked «(اختياري)».
- Helper text under the label when the format is not obvious. Errors appear under the field, start with what to do, and are linked from an error summary at the top on submit (SC 3.3.1, 3.3.3).
- Validate on blur and on submit, not on every keystroke. Never clear what the user typed.
- Forgiving input: accept Eastern and Western digits, spaces and dashes in phone/ID fields, and normalize. Accept both «ى/ي» and «ة/ه» variants in search.
- Autosave long forms (TNA, course creation) as drafts, show "Saved as draft 10:42".
- Do not ask for information the system already has (manager, branch, department come from the directory).
- Redundant entry (SC 3.3.7): information entered earlier in a flow is pre-filled, not re-typed.

### 4.2 Four-part Arabic names (FR-IAM-01, NFR-L10N-05)
| Field | Arabic label | English label | Example (AR) | Example (EN transliteration) |
|---|---|---|---|---|
| First name | الاسم الأول | First name | عبدالله | Abdullah |
| Father's name | اسم الأب | Father's name | محمد | Mohammed |
| Grandfather's name | اسم الجد | Grandfather's name | سعد | Saad |
| Family name | اسم العائلة | Family name | القحطاني | Al-Qahtani |

- Capture Arabic and English side by side (two rows of four fields on desktop; one group per language on mobile).
- Father's and grandfather's names are optional by default (many non-Arab employees and Egyptian records use 3 parts; expatriates may have 2). Tenant configurable.
- **Display name** is derived and editable: default Arabic "first + father + family" (عبدالله محمد القحطاني); full four-part name on certificates and official records when configured.
- Sort and search by family name and first name; search is tolerant to variants: «عبد الله/عبدالله»، «محمد/محمّد»، «أحمد/احمد»، hamza and taa marbuta forms, and Latin spellings (Mohammed/Muhammad/Mohamed).
- Never split a single Latin full name into four parts automatically; ask.
- Honorifics (الدكتور، المهندس) are a separate optional field, not part of the name.

### 4.3 Other MENA fields
- Mobile: country code selector (default from branch country) + national number, validated per country, displayed LTR.
- National ID / Iqama (KSA), Emirates ID, Egyptian national ID: masked by default (last 4 digits), format-validated, visible only to permitted roles.
- Currency amounts show the currency code/symbol and the tenant's decimal rules (3 decimals for OMR, BHD, KWD).

---

## 5. Data display patterns (summary)

| Pattern | Rule |
|---|---|
| Status | Badge = icon + word + color (subtle background). Session statuses: مسودة (neutral), مجدولة (info), مؤكدة (success), جارية (primary), مكتملة (neutral strong), ملغاة (danger), مؤجلة (warning). |
| Tables | Sticky header, identity column first, row actions at the end, bulk actions appear in a bar when rows are selected. Mobile: card list with the 3 most important fields. |
| Calendars | Week starts on the tenant's first working day (Sunday for KSA/Egypt, Monday for UAE); weekends shaded; prayer windows shown as thin bands on day/week views. |
| Timelines & history | Newest first; each entry: actor, action, time (relative ≤ 7 days), link to detail. |
| Empty states | Say what will appear here, why it is empty, and the one action to fill it (NFR-UX-04). |
| Loading | Skeletons matching the final layout for > 300 ms waits; spinners only inside buttons. Never block the whole screen for partial loads. |
| Errors | Inline, specific, with a way forward and a reference ID for support when it is a system error. |
| Numbers | Group separators per locale, units always shown (ساعة، ر.س، %). |

### 5.3 Currency
- Arabic: amount then symbol: `12,500.00 ر.س`، `3,200.000 ر.ع.`, `45,000.00 ج.م`. English: `SAR 12,500.00`.
- The new Saudi riyal symbol (Unicode U+20C1, 2025) is not yet supported by most fonts; use «ر.س» / "SAR" until IBM Plex Sans Arabic or the fallback fonts ship it (tracked as an open item).

---

## 6. Design QA checklist (per screen)

Adapted from Development Plan §9 heuristics. A screen is ready for review when:

- [ ] Designed in Arabic RTL first; English LTR checked; no physical CSS properties.
- [ ] One clear primary action; destructive actions have undo or a named confirmation.
- [ ] Empty, loading, error and "no permission" states designed.
- [ ] Works at 360 px with no horizontal scroll; primary actions within thumb reach on mobile.
- [ ] Dates follow §3; numerals and identifiers follow §2.3–2.4.
- [ ] Copy uses glossary terms and the content style guide; no machine translation.
- [ ] Contrast from tokens only; focus visible; keyboard path tested; screen-reader labels in both languages; `aria-live` for status changes.
- [ ] Light and dark themes checked.
- [ ] Audit visibility: who/when shown where the record is evidence.
