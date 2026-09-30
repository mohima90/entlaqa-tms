# Jadarat Design — Index

UX foundation for **Jadarat TMS** and the **Jadarat Suite shell** (Development Plan §6.3 Track A, §9). Arabic is designed first; English is a peer language. Everything here is v1 draft material, due to be validated in usability round 1 before Gate G1.

| Backlog | Deliverable | File(s) | Status |
|---|---|---|---|
| T-M1-A01 | Design principles, RTL rules, icon mirroring, numerals, bidi, Hijri/Gregorian display, form patterns (four-part names) | [`design-principles.md`](design-principles.md) | Draft v1 |
| T-M1-A01 | Design tokens (color, type, spacing, radius, elevation, motion, z-index, breakpoints; light + dark) | [`tokens/tokens.json`](tokens/tokens.json) (W3C DTCG format), [`tokens/tokens.css`](tokens/tokens.css) | Draft v1 — **brand colors are placeholders** |
| T-M1-A01 | WCAG 2.2 AA contrast check of every token pair (108 pairs, light + dark, 0 failures) and re-verification script | [`tokens/contrast-report.md`](tokens/contrast-report.md) | Pass |
| T-M1-A03 | Suite shell spec (FR-STE-08): header, module switcher, side nav, notification + approvals inboxes, search, tenant/branch context, user menu, mobile bottom nav, system states, navigation IA by role for R1 | [`suite-shell.md`](suite-shell.md) | Draft v1 |
| T-M1-A04 | Clickable prototype: 5 critical journeys + suite shell, AR/EN, light/dark, 360 px → desktop | [`prototype/index.html`](prototype/index.html) | Ready for usability round 1 |
| T-M1-A05 (prep) | Usability test round 1 plan: participants, screener, consent (AR/EN), tasks with targets, moderator script (AR/EN), SUS (AR/EN), note template, severity rubric, backlog flow | [`research/usability-test-round-1.md`](research/usability-test-round-1.md) | Ready for PO review; sessions are run by the PO |
| T-M1-A06 | AR/EN terminology glossary (144 terms, with rejected alternatives and reasons) | [`content/glossary-ar-en.md`](content/glossary-ar-en.md) | Draft v1 |
| T-M1-A06 | Content style guide: tone, formality, gender-inclusive Arabic, errors, button verbs, notification/WhatsApp templates, formatting | [`content/content-style-guide.md`](content/content-style-guide.md) | Draft v1 |

## Viewing the prototype

1. Open `docs/design/prototype/index.html` directly in a browser (double-click, or `open`/`xdg-open` the file). No build step or server is needed.
2. The landing page lists the journeys. Use the yellow **نموذج أولي / Prototype** bar to switch language (AR/EN) and theme, or to return to the journey list. Language, calendar (Gregorian / Hijri / both), numerals (0–9 / ٠–٩) and theme are also in the user menu (avatar) and are remembered in the browser.
3. To see navigation for each role, open **Explore the shell** and switch role from the user menu (prototype-only control).
4. Reload the page to reset all journey state (do this before each usability participant).
5. Mobile: use the browser's device toolbar at 360–390 px, or open the file on a phone.

Direct links (hash routes): `#home` · `#shell` · `#j1` (coordinator scheduling) · `#j2` / `#j2-wa` (approvals web / WhatsApp mock) · `#j3`, `#j3-expired`, `#j3-range` (QR check-in) · `#j4` (TNA form) · `#j5`, `#j5-expired`, `#j5-revoked` (certificate verification) · `#inst-qr` (instructor's rotating QR).

**External requests:** only Google Fonts (IBM Plex Sans Arabic, IBM Plex Sans, IBM Plex Mono). Offline, the page falls back to system fonts and still works. The file contains an inline copy of `tokens/tokens.css`; when tokens change, update both. It is a complete HTML document so it opens correctly from disk; if it is published later as a hosted page, the host's own document wrapper can replace the outer `<html>/<head>/<body>` tags.

**Checked on 30 Sep 2026:** headless Chromium at 390 × 844 and 1440 × 900, Arabic and English, light and dark: no console errors, no horizontal overflow on any route; journey interactions (conflict resolution, approve/undo, reject reason, QR outcomes, add/remove need, certificate lookup, search, Esc/focus return) pass.

## Key design decisions (v1)

- **Deep-teal placeholder brand** on neutrals with a slight teal bias; semantic colors reserved for status and always paired with an icon and a word.
- **IBM Plex Sans Arabic + IBM Plex Sans** (matched family for mixed AR/EN lines); Arabic sizes +10–15 % (base 18 px vs 16 px), line-height 1.7; no letter-spacing or italics in Arabic.
- **Logical CSS properties only**; side navigation at the inline-start edge (right in Arabic); icons mirror only when they express reading direction or time flow.
- **Dual Hijri/Gregorian** display: both on detail pages and date pickers; primary calendar only in dense lists and messages.
- **Western digits by default**, Eastern Arabic digits as a preference; identifiers (codes, certificate numbers, phones) never converted.
- **Gender-neutral Arabic UI** through verbal nouns on buttons, «يمكنك + verbal noun» guidance and system voice (we); role labels follow BRD §4.2.
- **«إلغاء» is reserved for cancelling records**; dialogs are dismissed with «رجوع».
- Approvals are **one tap in the list, two from a notification**, with a 10-second undo and outbound messages held until it expires.

## Open items for the Product Owner

| # | Item | Needed for |
|---|---|---|
| 1 | **ENTLAQA brand colors, logo and Jadarat wordmark** — replace `--color-brand-*` and re-run the contrast check | Before usability round 1 ideally; before M2 UI build at the latest |
| 2 | **Font licensing check**: IBM Plex Sans Arabic / IBM Plex Sans are SIL OFL (free to self-host); confirm with legal and decide on self-hosting for sovereign deployments. Cairo/Tajawal remain alternatives (NFR-L10N-02) | M1 (design system in code, T-M1-A02) |
| 3 | **Terminology to validate in round 1**: «جلسة» for *session* vs «دورة/دفعة»; «حصر الاحتياجات» for *TNA campaign* (glossary items marked 🔎) | Round 1 |
| 4 | **Form of address** preference field («صيغة المخاطبة») for personalized notifications, separate from the restricted HR gender field | R1 notification templates |
| 5 | Show unlicensed suite modules as "Coming soon" to non-admin users? (proposal: yes for commercial tenants, hidden for government) | Shell build (M2) |
| 6 | Arabic chart time-axis direction (right-to-left proposed) | Reporting (M6) |
| 7 | Saudi riyal symbol (U+20C1): adopt when fonts support it; «ر.س»/SAR until then | Formatting library (ADR 7) |
| 8 | Proposed targets for J4 (≤ 8 min for a 6-person team) and J5 (≤ 30 s per state) — BRD has no target | Round 1 |
| 9 | J1's prayer-time warning, J2's WhatsApp approval and J4's TNA form are **R2** features (FR-SCH-06, FR-ENR-06/NTF-03, PLN-03/MGR-05); designed now per Plan §6.3, labeled R2 in the prototype | Scope awareness |
| 10 | Sample prayer times in the prototype are illustrative; real times come from the calculation library chosen in ADR 7 | ADR 7 |
