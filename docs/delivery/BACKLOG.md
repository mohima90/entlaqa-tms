# Jadarat TMS — Delivery Backlog

> Working task list for the PO + Claude Code agent team (Development Plan §2.3). **Since 17 Oct 2026 the open work is organized by role and work package** (PO decision «Work organized by role», STATUS §2): the roadmap with every R1 feature, its status and its work package is [`ROADMAP-by-role.md`](ROADMAP-by-role.md); a new or second Claude account starts with [`HOW-TO-START.md`](HOW-TO-START.md). Sessions update the status here, in the roadmap and in `STATUS.md` before finishing.

**Status:** ⚪ To do · 🔵 In progress · 🟣 In review (PR open) · 🟢 Done (merged) · 🔴 Blocked · ⏸ Postponed · ✖ Cancelled / superseded
**Owner:** `PO` = human Product Owner · `Claude` = Claude Code session/agents
**IDs:** tasks `T-<milestone>-NN` (never renumbered or reused); work packages `WP-<role>-NN` ([roadmap §4](ROADMAP-by-role.md#4-work-packages)); epics `EP-*` (Development Plan Appendix G); features refer to `docs/brd/TMS_Feature_List.md`.

**Rules (unchanged):** one work package = one complete feature area = **one PR**; a WP that needs a business flow starts with the task «Business flow agreed with the PO», which blocks its other tasks (Development Plan §2.4 P1, §4.1; [`docs/business-flows/`](../business-flows/README.md)); no separate screen approval (PO, 17 Oct 2026); one independent review per PR (security review when security-relevant); the PO says yes before each PR and merges; database changes deploy automatically after merge.

**Claiming:** write your session / account name in the WP's «Claimed by» line below **and** in the roadmap's «Claimed by» cell, and commit that alone first on `claude/<wp-id>-<short>` ([HOW-TO-START §3](HOW-TO-START.md)).

**Contents:** [In flight](#in-flight) · [Organization Admin](#organization-admin) · [HR Manager](#hr-manager) · [L&D Manager](#ld-manager) · [Training Coordinator](#training-coordinator) · [Department Head](#department-head) · [Employee](#employee) · [Platform Super Admin](#platform-super-admin) · [Platform / cross-cutting](#platform--cross-cutting) · [PO & operations](#po--operations-no-work-package) · [Requirement map](#requirement-map-epics--work-packages) · [Archive](#archive-done-cancelled-superseded)

---

## Open work by role

### In flight

#### WP-FIX-02 Clean-up pass (role-play feedback, 27 Oct 2026)

**Claimed by:** tech lead session (27 Oct 2026) · **Business flow:** not needed — the PO's decision «Both» (`test-feedback-2026-10-27.md`); the PO approves the word list and the screens before the build · **Depends on:** —

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M3-17 | **Clean-up pass** (role play, 27 Oct 2026): one word per thing (word list approved by the PO, applied EN + AR, «unit» → the level's own name); wider dialogs and panels, needed fields first; brand colours on every page for every role (stylesheet instead of the nonce'd inline style — bug); logo without the box; bigger 2FA QR; searchable country list; a new unit takes its parent's branch; Grades placement and the delivery-type list as the PO decides | WP-FIX-02 | Claude | 🟡 PR open (27 Oct 2026: all 13 feedback points handled; forms standard `docs/design/forms-standard.md`) | FR-ADM-07, FR-ADM-05, FR-CAT-01, FR-IAM-11. One PR; no data changes; migration only if the delivery-type check changes (`202611031xxxxx`) |

#### WP-FIX-01 Test feedback fixes 1–3

**Claimed by:** tech lead session (17 Oct 2026) · **Business flow:** not needed — fixes approved by the PO (`test-feedback-2026-10-17.md` #1–3) · **Depends on:** —

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M3-11 | **Test feedback fixes 1–3** (guided test, 17 Oct 2026): Levels tab → «Organization tree» with the level chain; required name follows the default language (English first and family name required, Arabic optional) on invite, person profile, edit details and bulk import; the organization's own level names in every label (planning Scope / Budget / progress, invite and person forms, team list, role unit picker) instead of «Department» / «Department head» | WP-FIX-01 | Claude | 🔵 | FR-ADM-05, FR-IAM-01/03/04, FR-PLN-02. Approved by the PO 17 Oct 2026 (STATUS §2). One small PR; existing records unchanged. Migrations only if a check changes (`202610211xxxxx`) |

### Organization Admin

Order: E-mail sending → Branding → Audit log → people record completion → sign-in extras → later items ([roadmap §4.1](ROADMAP-by-role.md#41-organization-admin)).

#### WP-ADM-01 E-mail sending

**Claimed by:** Claude (17 Oct 2026) · **Business flow:** EP-EMAIL — **Agreed** (PO, 17 Oct 2026; `docs/business-flows/EP-EMAIL-email-sending.md`) · **Depends on:** — (unblocks WP-ADM-05, WP-LD-10, WP-TC-01)

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-46 | **Business flow agreed with the PO**: e-mail sending — Super Admin platform sender (Platform settings → E-mail) and Organization Admin **Email integration** (own provider), sender rule, test send, what happens when nothing is configured | WP-ADM-01 | Claude → PO | 🟢 | Flow written 16 Oct 2026, **agreed by the PO 17 Oct 2026** (no automatic fallback; e-mails wait while no sender) |
| T-M2-47 | **Platform sender + Email integration** (split from T-M2-23): Platform console → Settings → E-mail (provider key write-only and encrypted for the worker only, sender name / address, test e-mail); Settings → Email integration (platform sender by default, or Resend / SMTP / SendGrid / Mailgun / Microsoft 365 with from, reply-to and a test send); the worker picks the organization's provider, else the platform sender; production-setup §H (worker connections only); security review | WP-ADM-01 | Claude | 🔵 | FR-NTF-11, FR-NTF-02 (sending), FR-ADM-17 (platform settings); ADR 0008; decision 16 Oct 2026 (no sender in GitHub). **Built 17 Oct 2026 on the WP-ADM-01 branch, PR to open; code + security review pending.** Migrations `20261022100000`, `20261022100100`; secrets sealed for the worker (X25519 sealed box, worker secret `EMAIL_CREDENTIALS_KEY`, nothing in Vercel — email.md §1a); five providers; test send through the worker; e-mails wait while no sender (Super Admin warning, resume task, 7-day cap); delivery errors on the organization's page; SSRF guard for organization SMTP. Not built: provider webhooks, `infra/docker` key wiring. **Security review 17 Oct 2026 (approve with fixes) — fixed on the branch:** 60-second SMTP send deadline + test claims fail after 3 attempts (TIMEOUT) + 90-second test budget per pass (High); SMTP password bound to host:port and not kept when the server changes (Medium); submission ports only (465/587/2525), platform relay public unless `EMAIL_PLATFORM_SMTP_ALLOW_PRIVATE=true`, more IPv6 blocks, test e-mails 1/min (+20/day per organization), unsent tests fail after 7 days, platform sender's 24-hour failure count on the Super Admin page (Low). **Follow-up for the backlog (ID to assign at integration):** alert e-mail to the Super Admin when the platform sender fails |
| T-M2-48 | **Stale-delivery sweeper**: deliveries left waiting over 24 h become `failed` / `STALE` with their content removed, together with the delivery-log retention housekeeping | WP-ADM-01 | Claude | 🔵 | Follow-up of T-M2-06 ("before production"); same worker code. **Built 17 Oct 2026** (worker task `platform.email_housekeeping`: `STALE` after 1 day, `SENDER_WAIT_EXPIRED` after 7 days waiting for a sender, final rows purged after 12 months — BR-NTF-2); in the WP-ADM-01 PR |
| T-M2-20 | Released invitation the mailer refused shows as sent (re-review N1, Low; also manual invitations since T-M2-07): if the member an invitation is sent for loses the right between its release and the mailer, it stays `pending` with no link and `send_count` 0 — show it as «لم تُرسل الدعوة» (or put it back to held) and add a test | WP-ADM-01 | Claude | 🔵 | Paused (PO, 14 Oct 2026). Found in the T-M2-12 re-review (12 Oct 2026); no e-mail goes out, so no exposure — the list is misleading **17 Oct 2026 (re-organization by role):** resumed (PO «Work organized by role»: Organization Admin first) → WP-ADM-01 (sending path). **Built 17 Oct 2026** (WP-ADM-01 PR): an invitation the mailer refused is recorded (`private.invitation_mail_skips`) and the Team members list shows «Not sent: no e-mail went out» / «لم تُرسل الدعوة»; unit + integration tests |

#### WP-ADM-02 Branding

**Claimed by:** Claude session (20 Oct 2026) · **Business flow:** EP-BRAND — **Agreed (PO, 20 Oct 2026)** · **Depends on:** — (soft: WP-ADM-01, both touch the e-mail layout)

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-49 | **Business flow agreed with the PO**: Branding — names AR/EN (moved from General), logo, favicon, sign-in image, colours with gradient and presets, website; where the brand shows (product, sign-in page, e-mails) | WP-ADM-02 | Claude → PO | 🟢 | Kawadir first (CLAUDE.md); Jadarat palette stays the default (FR-ADM-07). **Agreed 20 Oct 2026** (`docs/business-flows/EP-BRAND-branding.md`, the three open questions approved) |
| T-M2-23 | Brand identity + e-mail sender — **re-scoped to Kawadir (15 Oct 2026):** Branding page (names AR/EN, logo, favicon, login page image, primary + secondary colour with "use gradient", preset colour sets, website) and **Email integration** page (platform sender or own provider: Resend, SMTP, SendGrid, Mailgun, Microsoft 365 / Graph; from name/address, reply-to, test send) (#10, #11, #37) | WP-ADM-02 | Claude | 🔵 | Paused until after the planning core (PO, 15 Oct 2026). FR-ADM-07, FR-NTF-02 (sending part), **FR-NTF-11 (R1 since 15 Oct 2026)**; logo uploads use `platform-files` (T-M2-18); provider credentials write-only, encrypted, worker-only (ADR 0008). E-mail look and texts belong to the L&D Manager **17 Oct 2026 (re-organization by role):** resumed (PO «Work organized by role»). **Split:** the Email integration / platform sender part is now **T-M2-47** (WP-ADM-01); this task is the **Branding page** (WP-ADM-02). **Built 20 Oct 2026 on the WP-ADM-02 branch, PR to open; code + security review done 20 Oct 2026 (approve with fixes) — all fixes made on the branch** (`docs/engineering/branding.md`). Migrations `20261023100000`–`20261023100300`: purposes `platform.brand_logo` / `brand_favicon` / `brand_sign_in_image` (PNG/JPEG/WebP; 2 MB / 500 KB / 5 MB), `platform.tenant_branding` (Org Admin writes — `platform.tenant.manage`, no new permission —, image trigger: own confirmed upload only, replaced / removed / unused images released), `platform.brand_assets` (worker-published copies of clean images in use, **metadata removed** (EXIF/GPS, XMP, IPTC, comments — no image library), pixel size capped at 4096 / favicon 512 px, served claim-less at `/api/brand/<id>`: one-day caching with CDN headers, cheap 304 revalidation, shared rate limiter, sandboxing CSP set by the proxy), `platform.brand_asset_attempts` (failed publications back off, given up after 5), names moved from General; audit names images by file id and sanitized name. Applied to the shell (colours, logo), favicon, sign-in page (by subdomain, else this device's last organization), the other pages before the suite (sign-up, forgot / reset password, invitations, sign-in code) and e-mails (logo, button / link colour). A failed image replacement puts the saved image back. Tests: pgTAP 99_branding_0…3 (+ 00, 10, 20, 80), unit (contrast, colours, image checks incl. SVG and sniffing, publishing task, e-mail layout, rbac negative tests), E2E EN+AR (preview mode; real `/api/brand/` headers; pixel cap). **Not built:** image re-encoding (`sharp`, PO licence decision as for profile photos — metadata is removed without it); custom-domain sign-in look (FR-ADM-10, R2); the data E2E (`BRANDING_E2E_*`) is not wired into the self-hosted smoke yet. **WP-ADM-02b (PO decision «B», 20 Oct 2026): branding images are no longer virus-scanned** — built 20 Oct 2026 on local branch `wp-adm-02b-instant-brand-images` (tech lead integrates): migrations `20261023100400`–`20261023100600` (`file_purposes.scan_required`, file status `accepted`, `private.publish_brand_image`, Storage read-back for the uploader, scan skips these purposes, worker fallback), Save reads/checks/strips before its transaction and publishes in it, the page no longer waits for a scan; pgTAP `99_branding_4…7`; new Arabic strings (`branding.images.ready`, `pendingPublish`, `errorDamaged`) for UX-writer review; self-hosted smoke not run (gateway route added on 8445) |

#### WP-ADM-03 Audit log screen

**Claimed by:** — · **Business flow:** on hold (PO, 21 Oct 2026) — `docs/business-flows/EP-AUD-audit-log.md` (T-M2-50) · **Depends on:** —

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-50 | **Business flow agreed with the PO**: audit log — who sees it, filters, export, retention, how personal data is shown (redacted before/after) | WP-ADM-03 | Claude → PO | ⚪ | Retention question = security decision 12 (legal) |
| T-M2-30 | Audit log screen (#44) | WP-ADM-03 | Claude | ⚪ | Paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. FR-AUD-01 **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-03. |

#### WP-ADM-04 People record completion

**Claimed by:** Claude engineering agent, 23 Oct 2026 — **built**, local branch, not pushed (for review and the PR) · **Business flow:** Agreed (PO, 21 Oct 2026; PO answers 21 and 23 Oct 2026) — `docs/business-flows/EP-PEOPLE-photo-hr-fields.md` (T-M2-51) · **Depends on:** WP-FIX-01 (same person forms)

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-51 | **Business flow agreed with the PO**: profile photo (who uploads, where it shows) and HR-only fields gender, date of birth, employment category, grade (who sees and edits them, import columns) | WP-ADM-04 | Claude → PO | 🟢 | Agreed 21 Oct 2026; PO answers 21 Oct and design answers 23 Oct 2026 are in the flow file. Legal flag still open: whether gender / birth date / nationality are sensitive (security decision 13) — before the first customer |
| T-M2-15 | **My profile** (self-service, FR-IAM-16): header picture/initials menu → My profile; change own names AR/EN, mobile, interface language, profile photo (needs file storage + scanning, ADR 0006); change password (current password, policy, other sign-in sessions ended, confirmation e-mail when T-M2-06 exists); e-mail and job data read-only; audited | WP-ADM-04 | Claude | ⚪ | PO request 5 Oct 2026 (BRD v2.2). **No screen approval** for this one (PO: the whole UI/UX will be redesigned). Next in the user sequence, then T-M2-13, T-M2-14, T-M2-05. **15a** (#34, merged): header picture (initials) → My profile; own names AR/EN (a full name without parts is pre-filled into the first name), mobile (Arabic digits, country code required), interface language (the page follows it); e-mail and job data read-only; password change (current password checked, 12+ characters, other sessions ended); audit with changed field names only; database write guard for persons/placements (TM-0004 F-PEO-01) with pgTAP tests; signed-in E2E as an ordinary member on the self-hosted stack. Security review: approve with fixes (1 Medium: passwords over 72 bytes → generic error; 7 Low) → fixed: 72-byte limit with its own message and Auth 4xx answers handled, HR cannot change a privileged member's record (Organization Admin only, like memberships), generated columns ignored and every `persons` column pinned in a test, family name optional and long prefills not forced, more pgTAP and unit tests, sessions-ended check in the smoke test. Follow-ups: Auth calls run inside the action's transaction (pool use, audit after the password changed — revisit with T-M2-11), the header name query adds one transaction per page (merge with grant loading later). **15b**: profile photo (needs file storage + scanning, ADR 0006) **17 Oct 2026 (re-organization by role):** 15a done (#34); only **15b (profile photo)** is open → WP-ADM-04 (was 🔵 although nobody was working on it). **BUILT 23 Oct 2026 (WP-ADM-04, local branch, not pushed — for review and the PR)**: **15b** — each member adds, replaces or removes THEIR OWN photo on My profile (PNG/JPG/WebP by content, ≤ 2 MB after the browser shrank it, hidden details removed, **not virus-scanned** — PO 21 Oct 2026, the branding-image path: `scan_required = false`, status `accepted`, a copy in `platform.person_photos`), shown in the profile header, Team members, the side panel and the top bar through the signed-in-only route `/api/photo/<person>`; old file deleted on replace/remove; audited with the file name only; migrations `20261025100300`. |
| T-M2-25 | Users completion: invitation link for one person (single use, 7 days, revocable) + more profile fields (#16, #20) | WP-ADM-04 | Claude | ⚪ | Paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. FR-IAM-01/02/03 (BRD v2.9); threat-model update for the link (TM-0003) **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-04. The invitation link for one person was **delivered by T-M2-44** (Copy invite link / code, #61); left: the extra profile fields (FR-IAM-02 gender, date of birth, employment category, grade) with the profile photo. **BUILT 23 Oct 2026 (WP-ADM-04, local branch, not pushed — for review and the PR)**: **gender, date of birth (Gregorian + Hijri), employment category** in `platform.person_hr_details` — read/written only through the new permission «View and edit HR-only fields» (`platform.person.hr_details`: HR Manager, custom roles; never the Organization Admin), the person reads their own; audit = field names and «hidden». **Grade** = the organization's list of codes (`platform.grades`, unique, letters/digits/punctuation) on the new **Organization → Grades** page (HR + Organization Admin), a person's grade in `platform.person_grades` (seen by HR, the Organization Admin, the person, their managers and unit heads). Migrations `20261025100000–100200`. **Parked:** the import wizard columns (grade / HR fields) — not small (processing functions + preview), see STATUS. |

#### WP-ADM-05 Sign-in extras

**Claimed by:** Claude engineering agent, 23 Oct 2026 — built on the local branch (not pushed; PR pending) · **Business flow:** Agreed (PO, 21 Oct 2026; design answers 23 Oct 2026) — `docs/business-flows/EP-AUTH-signin-extras.md` (T-M2-52) · **Depends on:** WP-ADM-01

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-52 | **Business flow agreed with the PO**: e-mail one-time codes as a second method and «trust this device for N days» (addendum to EP-KAW-AUTH) | WP-ADM-05 | Claude → PO | 🟢 | Agreed 21 Oct 2026; PO answers 21 Oct and the design answers of 23 Oct (final: «Email me a code» is a second way to sign in instead of the password for every user, not a setting, apart from MFA; both «Remember this browser» ticks stay) are in the flow file |
| T-M2-28 | E-mail one-time codes, trusted devices (#30) | WP-ADM-05 | Claude | 🟢 | **BUILT 23 Oct 2026 (WP-ADM-05, local branch, not pushed — for review and the PR; reworked after the PO's answers and the security re-review)**: **sign in with an e-mailed code** — a six-digit code of our own (Auth's one-time password is never e-mailed), valid 10 minutes, single use, 5 wrong tries kill it and pause checks 15 minutes (shared limiter, per typed address and client), one code a minute per address with a countdown, identical answers for every address (no enumeration), only a keyed hash stored (the sealed Auth token hash beside it), e-mailed AT ONCE by Auth's Send Email hook route on Vercel through the organization's own sender or the platform's, bilingual e-mail in the organization's look; no Auth secret key in the web app; MFA follows either first step (authenticator app, never a second e-mailed code). **Remember this browser** on the code screen = **keep me signed in** (Settings → Security «Remember a browser»: Off / 1 / 7 / 14 / 30 days, default Off): `private.kept_sessions`, kept once the sign-in is finished, never beyond *kept + the present strictest period*; My profile › Security lists and forgets them. Migrations `20261026100000–100300`, pgTAP `99_signin_1_kept_sessions_owner.sql`, `99_signin_2_codes_owner.sql`, unit tests, E2E `sign-in-code.spec.ts` (needs the self-hosted stack). **Parked:** an E2E journey with a real mailbox (smoke.sh/Mailpit), "Code by text message" and "Block reuse of earlier passwords" stay Coming soon. Earlier note — paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. = T-M2-10c without SMS (no SMS anywhere — PO, 14 Oct 2026) **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-05 (needs WP-ADM-01: e-mail must work). |
| T-M2-10c | MFA follow-ups (FR-IAM-12, R1): e-mail one-time codes, SMS one-time codes (needs an SMS provider decision from the PO), trusted-device duration | WP-ADM-05 | Claude | ⏸ (done by T-M2-28 without SMS) | **Superseded by T-M2-28** (no SMS — PO, 14 Oct 2026), which is paused until after the planning core (PO, 15 Oct 2026). Split from T-M2-10 on 9 Oct 2026; shown as «قريبًا» (Coming soon) on the security settings page until built |

#### WP-ADM-06 Plan, limits and feature toggles

**Claimed by:** Claude (`claude/youthful-davinci-00yhgl`) · **Business flow:** [EP-PLAN](../business-flows/EP-PLAN-plan-limits-feature-switches.md) — agreed 24 Oct 2026; design approved 24 Oct 2026 · **Depends on:** —

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-53 | **Business flow agreed with the PO**: editions and limits set by the Super Admin, organization status, plan view and feature toggles for the Organization Admin | WP-ADM-06 | Claude → PO | 🟢 | FR-SUB-01, FR-ADM-13, FR-ADM-17. Agreed 24 Oct 2026 (Super Admin creates plans; the Organization Admin only sees them — no switches); design approved 24 Oct 2026 |
| T-M2-27 | Feature toggles + plan and limits overview (#5, #49) | WP-ADM-06 | Claude | 🟢 | **Merged (#90) and deployed to production 24 Oct 2026.** Built 24 Oct 2026: Platform → Plans (create / edit: people and storage limits, features), an organization's page (plan, status, trial end, special limits), new organizations start on a plan as a 30-day trial; Subscription page for the Organization Admin (read-only), 90% notice on the home page, people / storage limits refused at the moment of the action (invite, reactivation, import row, upload), features outside the plan hidden and refused; trials end by a worker task; a suspended organization: its Organization Admin sees the plan page only, everyone else «Access paused». Migrations `20261027100000`–`100200` (role `plan_guard`). Not built: online payment / reactivation by the Organization Admin (later, PO 24 Oct 2026); outside the plan the Jadarat look applies everywhere (product, sign-in page, e-mails). **Independent review 24 Oct 2026: no Critical/High;** fixed: accepting an invitation above a lowered limit (M1), import row «people limit» label (M2), sign-in page look (M3), plan errors on «Create organization» (L2), trial date picker max (L3), trial expiry needs a job id (L7). **Follow-ups (Low, not in this PR):** storage limit checked on the declared size, the real size can exceed it by up to one file (L1); `tenant_plan_features` returns another organization's feature list to a caller who knows its id (L4, list only); a paused admin's sign-in is not audited (L5); a paused admin who also belongs to an active organization must sign out to switch (L6); the device limit is not applied while paused (L7). | Paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. FR-ADM-13, FR-SUB-01 **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-06 (with SUB-01 editions and the Super Admin's plan / limits / status). |

#### WP-ADM-07 Custom fields

**Claimed by:** Claude (branch `claude/youthful-davinci-00yhgl`) · **Business flow:** drafted 24 Oct 2026, **on hold until the whole product is built (PO, 24 Oct 2026)** (`EP-CF-custom-fields.md`, T-M2-54) · **Depends on:** best after WP-LD-05, WP-LD-06, WP-LD-08 — people and courses can ship first

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-54 | **Business flow agreed with the PO**: custom fields — entities, field types, who fills them, import | WP-ADM-07 | Claude → PO | 🔵 | Drafted 24 Oct 2026 (`docs/business-flows/EP-CF-custom-fields.md`): people + courses first, 8 field types, archive not delete, role visibility, import columns, filters; open Q1–Q3 |
| T-M2-26 | Custom fields builder (#6) | WP-ADM-07 | Claude | ⚪ | Paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. FR-ADM-11 **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-07 (best after the course / session / venue tables exist). |

#### WP-ADM-08 Consent settings

**Claimed by:** — · **Business flow:** to write (T-M2-55); legal answers first · **Depends on:** legal (security decision 13)

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-55 | **Business flow agreed with the PO**: consents asked, capture and withdrawal, effect of withdrawal | WP-ADM-08 | Claude → PO | ⚪ | Needed before geo-fenced check-in (WP-TC-02) |
| T-M2-31 | Consent settings (#45) | WP-ADM-08 | Claude | ⚪ | Paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. FR-AUD-05; lawful-basis questions stay with legal (security decision 13) **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-08 (legal answers first). |

#### WP-ADM-09 Suite / standalone mode

**Claimed by:** Claude (branch `claude/youthful-davinci-00yhgl`) · **Business flow:** drafted, **on hold (PO, 24 Oct 2026)** (`EP-MODE-suite-standalone.md`, T-M2-56) · **Depends on:** security decision 7 — **answered 24 Oct 2026: HR file sync in R2**

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-56 | **Business flow agreed with the PO**: suite vs. standalone mode, people data source | WP-ADM-09 | Claude → PO | 🔵 | Drafted 24 Oct 2026 (`docs/business-flows/EP-MODE-suite-standalone.md`): R1 every organization standalone, suite mode prepared but greyed out until Jadarat Core HR exists; open Q1–Q2 |
| T-M2-32 | Standalone / HR Suite mode + HR system CSV/SFTP sync (#40, #41) | WP-ADM-09 | Claude | ⚪ | Paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. FR-STE-01, FR-INT-01 (R1 part) **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-09 (HR system CSV/SFTP sync: R2 in the feature list, security decision 7 open). **24 Oct 2026 (PO, decision 7):** the automatic HR file / SFTP sync is **R2**; R1 keeps invitations + the bulk import. |

#### WP-ADM-10 LMS connection

**Claimed by:** — · **Business flow:** to write (T-M2-57) · **Depends on:** Jadarat LMS APIs (open dependency); WP-LD-05

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-57 | **Business flow agreed with the PO**: Jadarat LMS connection — set-up wizard, SSO, mapping, sync schedule, health | WP-ADM-10 | Claude → PO | ⚪ | — |
| T-M2-33 | LMS connection: Jadarat LMS setup wizard, SSO, mapping, sync schedule, health (#39) | WP-ADM-10 | Claude | ⚪ | Paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. FR-LMS-01/02/03/10; catalog and enrollment sync complete with the Training Manager's features **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-10 (needs the Jadarat LMS APIs). |

#### WP-ADM-11 Self-service sign-up + wizard

**Claimed by:** — · **Business flow:** **PO decision first** (T-M2-58) · **Depends on:** WP-ADM-01, WP-ADM-02

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-58 | **PO decision + business flow**: is self-service sign-up with a trial (FR-ADM-01) still R1, now that organizations are created by the Super Admin the Kawadir way? If yes, the flow (sign-up, trial, wizard ending with «invite your L&D Manager») | WP-ADM-11 | Claude → PO | ⚪ | Roadmap §7 flag 4 |
| T-M2-24 | Self-service sign-up + setup wizard ending with "invite your L&D Manager" (#2) | WP-ADM-11 | Claude | ⚪ | Paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. FR-ADM-01 (BRD v2.8) **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-11; **PO decision first**: self-service sign-up vs. organizations created by the Super Admin (the Kawadir way, EP-KAW-AUTH). |

#### WP-ADM-12 Admin home

**Claimed by:** — · **Business flow:** to write (T-M2-59) · **Depends on:** WP-ADM-03, WP-ADM-06, WP-ADM-10

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-59 | **Business flow agreed with the PO**: admin home contents | WP-ADM-12 | Claude → PO | ⚪ | — |
| T-M2-34 | Admin home (#1) | WP-ADM-12 | Claude | ⚪ | Paused until after the planning core (PO, 15 Oct 2026); resumes in the Kawadir layout. FR-ADM-14; last, when its data sources exist **17 Oct 2026 (re-organization by role):** resumed → WP-ADM-12 (last). |

### HR Manager

IAM-02 (HR-only person fields) is built in WP-ADM-04 ([roadmap §4.2](ROADMAP-by-role.md#42-hr-manager)).

#### WP-HR-01 Structure completion

**Claimed by:** Claude (branch `claude/youthful-davinci-00yhgl`) · **Business flow:** addendum to EP-ORG **agreed 24 Oct 2026** (`EP-ORG-structure-completion.md`, T-M3-12); design approved 24 Oct 2026; **done — #91 merged and deployed 24 Oct 2026** · **Depends on:** WP-FIX-01 (same structure pages — done)

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M3-12 | **Business flow agreed with the PO**: structure completion — cost centres, moving a unit to another parent (preview of the units and role assignments affected), drag-and-drop order, CSV import of units; GPS and working week / hours per branch (addendum to EP-ORG) | WP-HR-01 | Claude → PO | 🟢 | FR-ADM-04, FR-ADM-05; TM-0004 T-PEO-07. **Agreed 24 Oct 2026** (levels locked once people are placed; cost centre on the person, no split, no approver; a move keeps the level; import creates + updates; location typed). Drafted: cost centre list (inherited from the parent), move with preview (same level only), drag + Move up/down, unit import (create + update by code, never moves), branch address / location / own working week with half-days; open Q1–Q4 |
| T-M3-13 | **Build structure completion** per T-M3-12 (remember T-M3-02's C-8 note: the move cascade bumps `version` of every unit below) | WP-HR-01 | Claude | 🟢 | **#91, merged and deployed 24 Oct 2026.** Built: migrations `20261103100000`–`100300` (cost centres + person / unit default, levels locked once people are placed, a moved unit keeps its level, branch address / location / own week, `structure_guard` + `private.units_in_open_plan_cycles` for the move preview); Structure tabs Units / Levels / **Cost centres**, «Move to…» with preview, Move up / down + drag, **Import units** page; branch form address / location / week with half-days; person form cost centre. SQL + integration + unit + E2E (EN/AR) tests |

#### WP-HR-02 Compliance

**Claimed by:** — · **Business flow:** to write (T-M5-01) · **Depends on:** WP-LD-05, WP-LD-12, WP-EMP-04

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M5-01 | **Business flow agreed with the PO**: compliance rules, dashboards, overdue alerts, frameworks (regulatory content from BRD Appendix E only) | WP-HR-02 | Claude → PO | ⚪ | FR-CRT-07, FR-CRT-08, FR-REG-01 |
| T-M5-02 | **Build compliance** per T-M5-01 | WP-HR-02 | Claude | ⚪ | Migrations `202611041xxxxx` |

### L&D Manager

Planning first (agreed EP-PLN flow), then delivery set-up ([roadmap §4.3](ROADMAP-by-role.md#43-ld-manager)).

#### WP-LD-01 Department Head needs page

**Claimed by:** — · **Business flow:** EP-PLN — **Agreed** · **Depends on:** soft: WP-FIX-01 (level names)

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M3-05 | **Department Head needs form**: team from the structure; add needs (catalog course or new topic, people, priority, quarter, estimated cost, justification); save and submit before the deadline; L&D Manager sees progress per department | WP-LD-01 | Claude | 🔵 | FR-PLN-03, FR-MGR-05; BR-PLN-1 when compliance data exists **17 Oct 2026 (re-organization by role):** → **WP-LD-01**. Also: department-scoped read of the cycle for Department Heads (TODO left by T-M3-04); the progress page shows real states. **Built 27 Oct 2026 (branch `claude/youthful-davinci-00yhgl`, PR after #93 merges), per the PO's decisions Q1–Q3 and the approved design (`docs/design/screens/m3-needs-entry/README.md`):** migrations `20261105100000` (permission `tms.plan_needs.submit`, Department Head, scope headed departments; never in a custom role; belongs to the plan feature `planning`), `20261105100100` (`tms.plan_needs` — topic, optional course, seats, estimated cost, the form's other answers; `tms.plan_need_people` — named candidates; submission state on `tms.plan_cycle_departments` — submitted / returned stamps, return note, per-department deadline extension, department-level answers; guards: the effective head only (`private.may_submit_plan_needs`: role assignment in any scope + effective head + plan feature), entry closes after the effective deadline, submitted sets are locked, 200 needs / 500 names caps, the cycle closes only once every extension passed; RLS for heads and cycle readers), `20261105100200` (default form without the «Estimated cost» field — it is a column now). Module: rules, inputs, repository, `needs-definitions.ts` (head queries / actions with the effective-head check on the grant AND the structure; manager view, return, extend one department), server actions `@jadarat/tms/actions/needs`; `listDepartmentTeam` in platform-db. App: menu «My team's needs», Home banner + task cards, the needs page, the add / edit panel, submit summary, recall, the manager's read-only view with Return and Extend, the cycle progress with needs · seats and «View». Tests: pgTAP `99_planning_d_needs_0…2`, unit (rules, repository, definitions with the fake runtime, view helpers), E2E `needs-entry.spec.ts` (preview; data journey behind `NEEDS_E2E_HEAD_*`). **Not here:** «Send reminder» / automatic reminders / late summary (WP-PLT-01); edit on behalf after the deadline (WP-LD-02). |

#### WP-LD-02 Consolidation and budget check

**Claimed by:** — · **Business flow:** EP-PLN — **Agreed**; test feedback #4 agreed · **Depends on:** WP-LD-01

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M3-06 | **Consolidation and budget check**: needs by course / branch / quarter; sessions needed (head-count ÷ capacity respecting the minimum); estimated cost; totals per department vs. envelopes; L&D Manager and Training Coordinator adjust lines | WP-LD-02 | Claude | ⚪ | FR-PLN-05, 06; BR-PLN-2 (R1: envelopes) **17 Oct 2026 (re-organization by role):** → **WP-LD-02**. Includes the **department-limited L&D Manager** (test feedback #4, agreed 17 Oct 2026): unit-scoped permissions for needs, plan lines, envelopes and course creation; the organization-wide L&D Manager keeps cycle set-up / launch, needs forms and planning settings; the role builder explains which permissions stay organization-wide. Security review (scope = access). |

#### WP-LD-03 Plan approval

**Claimed by:** — · **Business flow:** EP-PLN — **Agreed** · **Depends on:** WP-LD-02; soft WP-PLT-01

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M3-07 | **Plan approval**: plan from the consolidation; sequential chain set by the L&D Manager (default Department Head → Finance approver → management approver; each step a role or a named person); comments, line-level rejection; locked and versioned on approval; audited | WP-LD-03 | Claude | ⚪ | FR-PLN-08, FR-WFL-01/02 (R1 part); BR-PLN-3. Security review (approval integrity) **17 Oct 2026 (re-organization by role):** → **WP-LD-03**. The approval engine is built reusable for the training-request chain (WP-EMP-01). |

#### WP-LD-04 Plan → courses → draft sessions

**Claimed by:** — · **Business flow:** EP-PLN — **Agreed** · **Depends on:** WP-LD-03

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M3-08 | **Approved plan → courses → draft sessions and training calendar** (hand-over to delivery): «Create course» from each approved line (pre-filled) or link an existing course, then draft sessions | WP-LD-04 | Claude | ⚪ | FR-PLN-09; may move to the start of M4 with scheduling **17 Oct 2026 (re-organization by role):** → **WP-LD-04** (draft sessions core; full scheduling in WP-LD-08). |

#### WP-LD-05 Catalog completion

**Claimed by:** — · **Business flow:** to write (T-M4-01) · **Depends on:** soft: WP-LD-04

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-01 | **Business flow agreed with the PO**: catalog completion — tags, templates, prerequisites and audience, objectives and competencies, materials, card/list view, employee browsing | WP-LD-05 | Claude → PO | ⚪ | — |
| T-M4-02 | **Build catalog completion** per T-M4-01 | WP-LD-05 | Claude | ⚪ | FR-CAT-01 (tags), 02, 03, 05, 06, 10. Migrations `202611091xxxxx` |

#### WP-LD-06 Venues and resources

**Claimed by:** — · **Business flow:** to write (T-M4-03) · **Depends on:** —

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-03 | **Business flow agreed with the PO**: venues, rooms, equipment, accessibility attributes | WP-LD-06 | Claude → PO | ⚪ | — |
| T-M4-04 | **Build venues and resources** per T-M4-03 | WP-LD-06 | Claude | ⚪ | FR-RES-01, 02, 03, 07. Migrations `202611101xxxxx` |

#### WP-LD-07 Instructors and portal

**Claimed by:** — · **Business flow:** to write (T-M4-05) · **Depends on:** —

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-05 | **Business flow agreed with the PO**: instructor profiles, qualifications, qualified-to-teach, availability, instructor portal | WP-LD-07 | Claude → PO | ⚪ | — |
| T-M4-06 | **Build instructors and portal** per T-M4-05 | WP-LD-07 | Claude | ⚪ | FR-INS-01…05. Migrations `202611111xxxxx` |

#### WP-LD-08 Sessions and scheduling

**Claimed by:** — · **Business flow:** to write (T-M4-07) · **Depends on:** WP-LD-04, WP-LD-06, WP-LD-07

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-07 | **Business flow agreed with the PO**: sessions and scheduling — multi-day, recurrence, lifecycle, calendar, conflicts, minimum enrollment, cost estimate → actual | WP-LD-08 | Claude → PO | ⚪ | **PO, 24 Oct 2026 (FR-FIN-03):** each session's cost is charged in one of two ways, chosen per session — **by participants** (default: cost ÷ participants, each share to the participant's own cost centre; e.g. USD 10,000 / 20 = 500 each → 5 + 5 + 10 people = 2,500 / 2,500 / 5,000) or **to one cost centre** (e.g. L&D carries a general course) |
| T-M4-08 | **Build sessions and scheduling** per T-M4-07 | WP-LD-08 | Claude | ⚪ | FR-SCH-01, 02, 03, 05, 08, FR-FIN-03. Migrations `202611121xxxxx` |

#### WP-LD-09 Enrollment

**Claimed by:** — · **Business flow:** to write (T-M4-09) · **Depends on:** WP-LD-08

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-09 | **Business flow agreed with the PO**: enrollment — admin bulk, self-enrollment, manager nomination, learner conflicts | WP-LD-09 | Claude → PO | ⚪ | — |
| T-M4-10 | **Build enrollment** per T-M4-09 | WP-LD-09 | Claude | ⚪ | FR-ENR-01, 02, 03, 13. Migrations `202611131xxxxx` |

#### WP-LD-10 Notifications set-up

**Claimed by:** — · **Business flow:** to write (T-M4-11) · **Depends on:** WP-PLT-01, WP-ADM-01, WP-ADM-02

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-11 | **Business flow agreed with the PO**: notification rules per event / role / channel, quiet hours, reminders and digests, e-mail look and texts | WP-LD-10 | Claude → PO | ⚪ | — |
| T-M4-12 | **Build notifications set-up** per T-M4-11 | WP-LD-10 | Claude | ⚪ | FR-NTF-07, 08, 02 (look). Migrations `202611141xxxxx` |

#### WP-LD-11 Assessments and surveys

**Claimed by:** — · **Business flow:** to write (T-M5-03) · **Depends on:** WP-LD-08

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M5-03 | **Business flow agreed with the PO**: question bank, tests, grading, surveys, evaluation forms | WP-LD-11 | Claude → PO | ⚪ | — |
| T-M5-04 | **Build assessments and surveys** per T-M5-03 | WP-LD-11 | Claude | ⚪ | FR-ASM-01, 02, 04, 05, 08. Migrations `202611151xxxxx` |

#### WP-LD-12 Certificates

**Claimed by:** — · **Business flow:** to write (T-M5-05) · **Depends on:** WP-TC-02, WP-LD-11

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M5-05 | **Business flow agreed with the PO**: certificates — designer, signatories, issuance rules (attendance thresholds), verification, expiry and renewal | WP-LD-12 | Claude → PO | ⚪ | — |
| T-M5-06 | **Build certificates** per T-M5-05 | WP-LD-12 | Claude | ⚪ | FR-CRT-01…05, FR-ATT-09. Migrations `202611161xxxxx` |

#### WP-LD-13 Reports

**Claimed by:** — · **Business flow:** to write (T-M6-01) · **Depends on:** WP-LD-08 … WP-LD-12

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M6-01 | **Business flow agreed with the PO**: executive dashboard and operational reports | WP-LD-13 | Claude → PO | ⚪ | — |
| T-M6-02 | **Build reports** per T-M6-01 | WP-LD-13 | Claude | ⚪ | FR-RPT-01, 02. Migrations `202611171xxxxx` |

#### WP-LD-14 Budget follow-up (BRD v3.5, PO 24 Oct 2026)

**Claimed by:** — · **Business flow:** to write (T-M4-23) · **Depends on:** WP-LD-03, WP-LD-08 (session costs), WP-LD-09

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-23 | **Business flow agreed with the PO**: budget follow-up — approved / committed / spent / remaining per department, the check before an enrollment or request is approved, revising and moving budgets during the year | WP-LD-14 | Claude → PO | ⚪ | FR-FIN-02, FR-FIN-01 (R1 part) |
| T-M4-24 | **Build budget follow-up** per T-M4-23 | WP-LD-14 | Claude | ⚪ | Migrations `202611181xxxxx` |

### Training Coordinator

#### WP-TC-01 Logistics

**Claimed by:** — · **Business flow:** to write (T-M4-13) · **Depends on:** WP-LD-08, WP-ADM-01

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-13 | **Business flow agreed with the PO**: session task checklists and joining instructions | WP-TC-01 | Claude → PO | ⚪ | — |
| T-M4-14 | **Build logistics** per T-M4-13 | WP-TC-01 | Claude | ⚪ | FR-LOG-01, 02. Migrations `202611181xxxxx` |

#### WP-TC-02 Attendance

**Claimed by:** — · **Business flow:** to write (T-M5-07) · **Depends on:** WP-LD-09; WP-ADM-08 (ATT-03)

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M5-07 | **Business flow agreed with the PO**: attendance — roster, QR and geo-fenced check-in, minutes, printable sheets | WP-TC-02 | Claude → PO | ⚪ | — |
| T-M5-08 | **Build attendance** per T-M5-07 | WP-TC-02 | Claude | ⚪ | FR-ATT-01, 02, 03, 04, 11. Migrations `202611191xxxxx` |

### Department Head

MGR-05 (needs form) is WP-LD-01; ENR-02 (nominate) is WP-LD-09.

#### WP-DH-01 Manager hub

**Claimed by:** — · **Business flow:** to write (T-M4-15) · **Depends on:** WP-LD-03, WP-LD-09

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-15 | **Business flow agreed with the PO**: manager hub — team dashboard, approvals inbox, team calendar, nominate with deadline | WP-DH-01 | Claude → PO | ⚪ | — |
| T-M4-16 | **Build the manager hub** per T-M4-15 | WP-DH-01 | Claude | ⚪ | FR-MGR-01…04. Migrations `202611201xxxxx` |

### Employee

IAM-16 (profile photo) is WP-ADM-04; ENR-01 (self-enrollment) is WP-LD-09.

#### WP-EMP-01 Training requests

**Claimed by:** — · **Business flow:** to write (T-M4-17) · **Depends on:** WP-LD-03 (approval engine), WP-LD-05

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-17 | **Business flow agreed with the PO**: training requests and their approval chain (WFL-01 request chain) | WP-EMP-01 | Claude → PO | ⚪ | — |
| T-M4-18 | **Build training requests** per T-M4-17 | WP-EMP-01 | Claude | ⚪ | FR-PLN-01, FR-WFL-01 (request chain). Migrations `202611211xxxxx` |

#### WP-EMP-02 My learning

**Claimed by:** — · **Business flow:** to write (T-M4-19) · **Depends on:** WP-LD-09

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-19 | **Business flow agreed with the PO**: My learning, personal calendar (.ics), notification preferences | WP-EMP-02 | Claude → PO | ⚪ | — |
| T-M4-20 | **Build My learning** per T-M4-19 | WP-EMP-02 | Claude | ⚪ | FR-LRN-01, 03, 07. Migrations `202611221xxxxx` |

#### WP-EMP-03 Mobile app (PWA)

**Claimed by:** — · **Business flow:** to write (T-M5-09) · **Depends on:** WP-TC-02, WP-EMP-02

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M5-09 | **Business flow agreed with the PO**: installable app — check-in, materials, surveys, certificates | WP-EMP-03 | Claude → PO | ⚪ | — |
| T-M5-10 | **Build the PWA** per T-M5-09 | WP-EMP-03 | Claude | ⚪ | FR-LRN-04. Migrations `202611231xxxxx` |

#### WP-EMP-04 External certifications

**Claimed by:** — · **Business flow:** to write (T-M5-11) · **Depends on:** WP-LD-12

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M5-11 | **Business flow agreed with the PO**: external certificates uploaded by employees and approved by HR | WP-EMP-04 | Claude → PO | ⚪ | — |
| T-M5-12 | **Build external certifications** per T-M5-11 | WP-EMP-04 | Claude | ⚪ | FR-CRT-06. Migrations `202611241xxxxx` |

### Platform Super Admin

Platform e-mail settings are WP-ADM-01; editions, limits and organization status are WP-ADM-06.

#### WP-SA-01 Console completion

**Claimed by:** — · **Business flow:** addendum to EP-KAW-AUTH to write (T-M2-60) · **Depends on:** —

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M2-60 | **Business flow agreed with the PO**: console completion — console MFA, suspend / reactivate an organization (what happens to e-mails in flight — STATUS §5 item 12), health, announcements, audited impersonation, second staff approval (security decision 8) | WP-SA-01 | Claude → PO | ⚪ | FR-ADM-17; risk R-65 |
| T-M2-61 | **Build console completion** per T-M2-60; security review | WP-SA-01 | Claude | ⚪ | Migrations `202611251xxxxx` |

### Platform / cross-cutting

#### WP-PLT-01 In-app notifications

**Claimed by:** — · **Business flow:** to write — short (T-M3-14) · **Depends on:** — (can start any time)

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M3-14 | **Business flow agreed with the PO**: in-app notifications — what appears in the bell, read / unread, planning reminders and «Send reminder», automatic closing of a cycle after its deadline | WP-PLT-01 | Claude → PO | ⚪ | Unblocks the open items of T-M3-04 |
| T-M3-15 | **Build in-app notifications** per T-M3-14 (notification center, bell, planning reminder sending, scheduled cycle closing) | WP-PLT-01 | Claude | ⚪ | FR-NTF-01, FR-PLN-02, FR-STE-08. Migrations `202611261xxxxx` |

#### WP-PLT-02 Hijri date picker

**Claimed by:** — · **Business flow:** not needed (UI component following the organization's setting) · **Depends on:** —

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M3-16 | **Hijri / Gregorian / dual date picker** in `@jadarat/ui` used by every date field, and a per-user date preference in My profile | WP-PLT-02 | Claude | ⚪ | FR-SCH-07. Migrations `202611271xxxxx` (user preference) |

#### WP-PLT-03 Suite shell completion

**Claimed by:** — · **Business flow:** to write (T-M4-21) · **Depends on:** WP-LD-03, WP-PLT-01

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M4-21 | **Business flow agreed with the PO**: approvals inbox, module switcher, mobile shell | WP-PLT-03 | Claude → PO | ⚪ | — |
| T-M4-22 | **Build suite shell completion** per T-M4-21 | WP-PLT-03 | Claude | ⚪ | FR-STE-08. Migrations `202611281xxxxx` |

#### WP-PLT-04 Arabic-only mode

**Claimed by:** — · **Business flow:** to write (T-M6-03) · **Depends on:** —

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M6-03 | **Business flow agreed with the PO**: Arabic-only operating mode for government organizations | WP-PLT-04 | Claude → PO | ⚪ | — |
| T-M6-04 | **Build Arabic-only mode** per T-M6-03 | WP-PLT-04 | Claude | ⚪ | FR-DEP-05. Migrations `202611291xxxxx` |

#### WP-PLT-05 LMS sync

**Claimed by:** — · **Business flow:** to write (T-M6-05) · **Depends on:** WP-ADM-10, WP-LD-09, WP-TC-02

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M6-05 | **Business flow agreed with the PO**: catalog sync, enrollment push, completion pull and reconciliation | WP-PLT-05 | Claude → PO | ⚪ | — |
| T-M6-06 | **Build LMS sync** per T-M6-05 | WP-PLT-05 | Claude | ⚪ | FR-LMS-05, 06, 07. Migrations `202611301xxxxx` |

#### WP-PLT-06 Accessibility pass and hardening

**Claimed by:** — · **Business flow:** not needed · **Depends on:** most WPs

| ID | Task | WP | Owner | Status | Notes / PR |
|---|---|---|---|---|---|
| T-M6-07 | **Accessibility pass**: full WCAG 2.2 AA review in Arabic and English of every R1 journey (axe stays in every PR meanwhile) | WP-PLT-06 | Claude | ⚪ | FR-LRN-08; then `EP-M7-HARD` (Development Plan §6.9). Migrations `202612011xxxxx` if any |

### PO & operations (no work package)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M2-37 | **New production Supabase project from scratch** (PO, 15 Oct 2026 — replaces the earlier idea of transferring the old project): `jadarat-tms` in the new ENTLAQA organization on **Pro** (daily backups, no pausing), Frankfurt `eu-central-1`, Data API off; all migrations applied fresh; new connection secrets in GitHub environments `production` / `production-jobs` and in Vercel; Auth settings redone (hooks, SMTP, templates, OTP, password rules, leaked-password protection, rate limits, sign-up gate), Storage checks, worker, first organization, checks; then the old project `jadarat-tms-staging` deleted | PO (guided by Claude, one step at a time) | 🔵 | Complete ordered checklist: [`docs/engineering/production-setup.md`](../engineering/production-setup.md) (40 steps; Claude cannot reach `*.supabase.co`). New ref **`pbmzlxljyjsvrzvkklbg`**, organization **`ENTLAQA-Products`** — fill in. Revisit RR-IAM-01 and R-36 with the Pro plan **17 Oct 2026 (re-organization by role):** **mostly done** (was ⚪): project created, environments, DB deploy plan → apply, Auth settings and hooks, sign-up gate, Storage checks, Vercel variables, Super Admin and the first organization `entlaqa` — production works end to end since 16 Oct (session log). **Left:** §H worker / e-mail (waits for WP-ADM-01; no sender in GitHub — PO 16 Oct), `APP_BASE_URL` in Vercel if not yet set (STATUS §5, 16 Oct), step 39 (Claude removes the `staging` choices), step 40 (PO deletes the old project `jadarat-tms-staging`). |
| T-M0-11 | GitHub environment `staging`: add the PO as **Required reviewer** (every DB deploy / provisioning run waits for approval) | PO | ⏸ | Deferred (3 Oct 2026): the PO is the only repository collaborator and staging holds test data only. **15 Oct 2026:** the project is now production and DB deploys run automatically after merge (PO decision) — the PO's merge is the approval, so the automatic path gets **no** required reviewer (Tech Lead proposal; risk R-63); a required reviewer stays advisable for the manual provisioning workflow and is needed before a second person gets repository access |
| T-M0-08 | ~~Recruit 3–5 design partners now~~ → **deferred (PO decision, 3 Oct 2026):** the customers who shaped the BRD get **2-week trial accounts** once a near-complete product exists (target: core flow catalog → schedule → enroll → attend → certificate working, ≈ end of M5); until then usability tests use ENTLAQA staff | PO | ⏸ | Re-planned as T-M5-TRIAL (see M5 note below); not blocking G0 |
| T-M0-12 | Pen-test vendor shortlist (KSA/UAE-capable, Arabic UI) | Claude prepares, PO contacts | ⚪ | Plan §6.2; needed by M7 (independent pen test before GA). Security tooling: CI already runs CodeQL, gitleaks, `pnpm audit`, Trivy (free) — no licences needed so far |
| T-M1-C02 | Threat models for R1 epics (M2–M6) | Claude | 🔵 | **M2 done** (3 Oct 2026): TM-0002 tenancy, TM-0003 identity & roles, TM-0004 people directory, TM-0005 audit & consent, TM-0006 shell & notifications; risk register v0.2 (R-34…R-55). M3–M6 models (TM-0007…0010) before each epic starts **17 Oct 2026 (re-organization by role):** M3–M6 threat notes are now written per security-relevant work package (in its PR) instead of one model per epic. |
| T-M1-B14 | R1 estimation and re-baselined milestone plan; update BRD §16 | Claude → PO approval | ⏸ | **Postponed by the PO (4 Oct 2026):** build step by step instead; revisit when the PO asks |

---

## Requirement map (epics → work packages)

> The epics of the original plan remain the requirement map (Development Plan §6.1, Appendix G); epic IDs keep their original milestone prefix. Since 17 Oct 2026 the work is planned and claimed by **work package** (column «WP»).

| Milestone | Epic | Features | WP | Status |
|---|---|---|---|---|
| M2 | `EP-M2-TEN` Tenancy & onboarding | ADM-01, 02, 04, 05, 07, 11, 13, 14, 17 · SUB-01 · DEP-01, 05 — ADM-17 includes **platform settings** managed by the Platform Super Admin (PO, 6 Oct 2026; BRD v2.3): e-mail provider key (write-only, encrypted so only the worker can read it), sender name/address, test e-mail; MFA + audit. Until then the settings live in the worker's environment (`staging-jobs`) | WP-ADM-01, 02, 06, 11, 12, WP-HR-01, WP-SA-01, WP-PLT-04; DEP-01 legal = PO | 🔵 ADM-02 done (#58); ADM-04/05 screens and ADM-17 console partly (#61, #64); rest per WP. Was ⚪ |
| M2 | `EP-M2-IAM` Identity & roles | IAM-01…05, 07 (six standard roles + custom role builder → `EP-ROLES`), 12, 13 — carry-overs from T-M1-D03: application sign-in rate limit (SCS-16, release blocker for real users), failed sign-ins as security events, MFA tenant policy (IAM-12), session time-box/inactivity, organization switch in the suite, password reset + invitations | WP-ADM-04, 05, 07 (done parts archived) | 🟢 R1 core done (T-M2-01…18, #28–#58; codes and roles #61, #63; department-limited roles #64); left: IAM-01 photo / custom fields, IAM-02, IAM-12 extras. Was: 🔵 Screens in PO review (4 Oct 2026): users list, invite + role, user profile, deactivate + reassign, roles & permissions, security settings, invitation e-mail, accept invitation, invitation link states, forgot / reset password |
| M2 | `EP-M2-PEO` People directory & suite mode | STE-01, 02 | WP-ADM-09 (STE-01); STE-02 done | ⚪ |
| M2 | `EP-M2-AUD` Audit & consent | AUD-01, 05 | WP-ADM-03, WP-ADM-08 | ⚪ |
| M2 | `EP-M2-SHELL` Suite shell, notifications, Hijri | STE-08 (Kawadir layout → `EP-SHELL-K`) · NTF-01, 02, 07, 11 · SCH-07 | WP-PLT-01, 02, 03, WP-ADM-01, WP-LD-10 | ⚪ |
| M3 | `EP-PLN` Planning core | ADM-04, 05 (screens) · CAT-01, 10 · PLN-02, 03, 05, 06, 08, 09 · MGR-05 · WFL-01, 02 (R1 part) | WP-LD-01 … 04, WP-FIX-01 | 🔵 T-M3-01…04, 09, 10 done (#64); T-M3-05…08 → WP-LD-01…04. Was ⚪ (tasks above) |
| M4 | `EP-M3-CAT` Catalog | CAT-02, 03, 05, 06 (CAT-01, 10 in `EP-PLN`) | WP-LD-05 | ⚪ |
| M4 | `EP-M3-SCH` Scheduling & conflicts | SCH-01, 02, 03, 05, 08 · FIN-03 | WP-LD-08 (draft sessions WP-LD-04) | ⚪ |
| M4 | `EP-M3-RES` Venues & resources | RES-01, 02, 03, 07 | WP-LD-06 | ⚪ |
| M4 | `EP-M3-INS` Instructors & portal | INS-01…05 | WP-LD-07 | ⚪ |
| M4 | `EP-M4-ENR` Enrollment, requests & approvals | ENR-01, 02, 03, 13 · PLN-01 | WP-LD-09, WP-EMP-01 | ⚪ |
| M4 | `EP-M4-MGR` Manager hub | MGR-01…04 | WP-DH-01 | ⚪ |
| M4 | `EP-M4-LRN` Learner PWA | LRN-01, 03, 04, 07 · NTF-08 | WP-EMP-02, WP-EMP-03, WP-LD-10 (NTF-08) | ⚪ |
| M4 | `EP-M4-LOG` Logistics tasks | LOG-01, 02 | WP-TC-01 | ⚪ |
| M5 | `EP-M5-ATT` Attendance | ATT-01…04, 09, 11 | WP-TC-02, WP-LD-12 (ATT-09) | ⚪ |
| M5 | `EP-M5-ASM` Assessments & surveys | ASM-01, 02, 04, 05, 08 | WP-LD-11 | ⚪ |
| M5 | `EP-M5-CRT` Certificates & compliance | CRT-01…08 · REG-01 | WP-LD-12, WP-HR-02, WP-EMP-04 | ⚪ |
| M5 | `T-M5-TRIAL` Customer trial: 2-week trial accounts for the customers who shaped the BRD (≥ 2 Saudi, ≥ 1 government/bank), once plan → schedule → enroll → attend → certificate works (needs the separate test environment before real data — PO, 15 Oct 2026); Claude prepares invitations, trial guide and feedback form; PO invites (replaces T-M0-08, PO decision 3 Oct 2026) | — | PO (after WP-TC-02 / WP-LD-12) | ⚪ |
| M6 | `EP-M6-LMS` LMS framework & Jadarat connector | LMS-01, 02, 03, 05, 06, 07, 10 | WP-ADM-10, WP-PLT-05 | ⚪ |
| M6 | `EP-M6-RPT` Reports & accessibility pass | RPT-01, 02 · LRN-08 | WP-LD-13, WP-PLT-06 | ⚪ |
| M7 | `EP-M7-HARD` Hardening & launch | — (Plan §6.9) | WP-PLT-06 | ⚪ |

---

## Archive (done, cancelled, superseded)

> The original sections in their original order, with the rows of tasks that are done, cancelled or superseded, kept intact (statuses corrected on 17 Oct 2026 where the BACKLOG was behind the code — marked «17 Oct 2026 (re-organization by role)»). Open tasks of these sections moved to [Open work by role](#open-work-by-role) under their work package.

### M0 — Mobilize

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M0-01 | Decide delivery team model | PO | 🟢 | PO + Claude agents (Plan §2.3) |
| T-M0-02 | Adapt Development Plan to agent team model | Claude | 🟢 | #8 |
| T-M0-03 | Create backlog file (this document) | Claude | 🟢 | #8 |
| T-M0-04 | Add PR template and CODEOWNERS | Claude | 🟢 | #8 |
| T-M0-05 | Vercel project `jadarat-tms` with build-skip rule | PO + Claude | 🟢 | #6, #7 |
| T-M0-06 | GitHub branch protection on `main` (require PR, require status checks once CI exists, block force-push/deletion) | PO | 🟢 | Ruleset `main protection` (1 Oct 2026): PR required (0 approvals), conversations resolved, checks `CI gates` + CodeQL ×2, no force-push/deletion, no bypass |
| T-M0-07 | Supabase organization + project for staging (region `eu-central-1` Frankfurt) | PO | 🟢 | `jadarat-tms-staging` (ref `kgmhlmiwlbvdmalesexv`, org `entlaqa-TMS`, Free plan), Data API off (1 Oct 2026) |
| T-M0-09 | Close decision D3 (planning-cycle timing) | PO | 🟢 | Decided: R2 |
| T-M0-10 | MFA (two-step sign-in) on every team account: GitHub, Supabase, Vercel, the e-mail account behind them; secrets only in the password manager | PO | 🟢 | Confirmed 3 Oct 2026: enabled on GitHub (passkeys, 2FA required), Supabase and Vercel since the accounts were created (PO) |
| T-M0-13 | Error-tracking vendor | Claude (delegated by PO, 4 Oct 2026) | 🟢 | Sentry SaaS EU region (cloud) + self-hosted GlitchTip (sovereign); same SDK (ADR 0009 §4). Account set-up with T-M1-D06 |

*Moved to open work: T-M0-08, T-M0-11, T-M0-12.*

Plan §6.2 items that do not apply to the agent-team model (§2.3): team staffing/RACI (= T-M0-01), separate project tracker (this file), Figma (design artifacts in `docs/design/`), kick-off (`CLAUDE.md` + session routine). Open decisions D4, D5, D8–D10 are scheduled in STATUS §2 ("Needed by").

**Gate G0 (adapted): 🟢 passed 3 Oct 2026.** T-M0-01…07, 09, 10 done; T-M0-08 and T-M0-11 deferred by PO decision; T-M0-12/13 are needed later (M7 / T-M1-D06), not for G0.

---

### M1 — Foundation

#### Track B — Architecture (`EP-M1-ARCH`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-B01 | ADR 0001 Monorepo layout & module boundaries | Claude | 🟢 | #9 |
| T-M1-B02 | ADR 0002 Tenancy, tenant resolution, RLS pattern, JWT tenant claim | Claude | 🟢 | #9 |
| T-M1-B03 | ADR 0003 AuthN/AuthZ, permissions & data scopes | Claude | 🟢 | #9 |
| T-M1-B04 | ADR 0004 Domain events (outbox + PostgreSQL queue), idempotency | Claude | 🟢 | #9 |
| T-M1-B05 | ADR 0005 Background jobs & scheduling (self-hostable) | Claude | 🟢 | #9 |
| T-M1-B06 | ADR 0006 File storage, signed URLs, virus scanning | Claude | 🟢 | #9 |
| T-M1-B07 | ADR 0007 i18n/RTL, Hijri & working calendars, prayer times | Claude | 🟢 | #9 |
| T-M1-B08 | ADR 0008 Notification service abstraction | Claude | 🟢 | #9 |
| T-M1-B09 | ADR 0009 Observability | Claude | 🟢 | #9 |
| T-M1-B10 | ADR 0010 Sovereign deployment approach | Claude | 🟢 | #9 |
| T-M1-B11 | ADR 0011 API style, versioning, error model | Claude | 🟢 | #9 |
| T-M1-B12 | ADR 0012 AI provider abstraction & governance (draft) | Claude | 🟢 | #9 (stays Draft until R2) |
| T-M1-B13 | R1 logical data model & migration conventions | Claude | 🟢 | #9 |

*Moved to open work: T-M1-B14.*

#### Track C — Security baseline (`EP-M1-SEC`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-C01 | Platform threat model (STRIDE) | Claude | 🟢 | #9 |
| T-M1-C03 | Risk register | Claude | 🟢 | #9 |
| T-M1-C04 | OWASP ASVS L2 mapping to modules | Claude | 🟢 | #9 |
| T-M1-C05 | Secure coding standard | Claude | 🟢 | #9 |

*Moved to open work: T-M1-C02.*

#### Track D — Engineering platform (`EP-M1-PLAT`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-D01 | Monorepo scaffold (`apps/suite`, `packages/ui`, `packages/platform-*`, `modules/tms`) | Claude | 🟢 | #9 |
| T-M1-D02 | CI with all 14 gates (Plan §5.3) | Claude | 🟢 | #9; all 17 checks green on GitHub |
| T-M1-D03 | Walking skeleton: sign-in → Arabic RTL suite shell → audit event, on staging | Claude | 🟢 | #9–#14. **Live on staging (1 Oct 2026):** migration `…session_tenants` applied, Vercel env vars set, Auth sign-ups off, Site URL set, ECC signing keys confirmed; organization `entlaqa-demo` provisioned; PO signed in (`/en/suite` shows "Organization: ENTLAQA"), signed out, `/ar/suite` redirects to sign-in. MFA off by default (PO). Runbook: [staging-sign-in.md](../engineering/staging-sign-in.md) |
| T-M1-D04 | Walking skeleton on self-hosted stack (Docker) | Claude | 🟢 | 4 Oct 2026: `infra/docker` (Postgres 17.11 + Auth/GoTrue + TLS gateway + distroless app image), real browser sign-in, hook / ES256-JWKS / TOTP→aal2 verified (ADR 0010 §3a), CI gate 15 on every PR; Supabase settings now read at runtime (one image for all deployments); independent review findings fixed (secrets out of logs, TLS-only database, network isolation, hardening). Spike report: `infra/docker/README.md` |
| T-M1-D05 | Vercel: Root Directory `apps/suite`, preset Next.js, move `vercel.json` | PO (dashboard) + Claude | 🟢 | Root Directory `apps/suite`, Node 24; `main` deployment Ready (1 Oct 2026) |
| T-M1-D06 | Observability baseline (errors, logs, uptime) | Claude | 🟢 | Part a (4 Oct 2026, #24 merged, live on staging): JSON logs without PII, server-side error tracking (Sentry EU, runtime DSN), `/api/health/live`+`/ready`, staging uptime workflow, PII log scan in gate 15 — `docs/engineering/observability.md`. Part b: browser errors via a scrubbing tunnel + favicon redirect (#25 merged); GlitchTip 6.2.6 in `infra/docker` with a browser + server error check in gate 15 (4 Oct 2026). Follow-ups (not M1): source-map upload (licence-compatible path), OpenTelemetry traces/metrics + alert rules + status page (M2/M3), production uptime vendor (before the first customer) |

#### Track A — UX foundation (`EP-M1-UX`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-A01 | Design principles & Arabic-first design tokens | Claude | 🟢 | #9 |
| T-M1-A02 | Component library in `packages/ui` + Storybook (RTL/LTR, light/dark) | Claude | 🟢 | v1 (3 Oct 2026): Button, Card, TextField, Alert, Badge, AppShell; Storybook 10 with Arabic/English × light/dark toolbar; CI gate 8 runs axe on every story in all 4 modes; sign-in forms use the library. Further components arrive with the M2 screens |
| T-M1-A03 | Suite shell design (navigation, inboxes, search, mobile) | Claude | 🟢 | #9 |
| T-M1-A04 | Clickable prototypes of 5 critical journeys | Claude | 🟢 | #9; `docs/design/prototype/index.html` |
| T-M1-A05 | Usability test round 1 (scripts, tasks, analysis by Claude; sessions run by PO with **ENTLAQA staff as stand-in users** — PO decision 3 Oct 2026) | PO + Claude | ✖ | **Cancelled 4 Oct 2026:** the PO found the clickable mock-up too shallow to test. Replaced by product-level screen reviews before each feature is built, and tests of the real product with ENTLAQA staff once journeys work. The kit in `docs/design/research/` is reused for those tests |
| T-M1-A06 | AR/EN glossary & content style guide | Claude | 🟢 | #9; 144 terms |

**Gate G1:** see Development Plan §6.3.

---

### M2 — Platform core: tasks

Screens are approved by the PO before each feature is built (PO decision 4 Oct 2026). Order below is the build order.

#### `EP-M2-IAM` Identity & roles — screens approved 4 Oct 2026 ([`docs/design/screens/m2-users-roles/`](../design/screens/m2-users-roles/README.md))

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M2-01 | Organization structure needed by users: departments (hierarchy, head) and branches, with RLS + cross-tenant tests (ADM-04/05 subset; full admin screens with `EP-M2-TEN`) | Claude | 🟢 | #28. Tables `platform.branches`, `platform.departments` (tree ≤ 10 levels, no cycles, one HQ, codes unique per organization, soft delete) + `private.stamp_row()` ([std] columns from verified claims); db tests + hosted simulation pass. Independent review: approve with fixes (2 Medium: concurrent moves could form a cycle; soft-delete actor/time could be forged; 6 Low) — all fixed with tests (advisory lock per tenant, verified with two sessions; re-review: deleted rows obey the tree rules too, branch delete vs. new department race closed (verified), names checked by `private.has_visible_text` with escaped characters, trigger order asserted; final re-review: **approve**; `stamp_soft_delete`; immutable id; person only from user claims; branch cycles; no deleted parents/branches, active head; IANA timezone; invisible-only names). Deferred to EP-M2-TEN: GPS, working calendars, cost centers, department `path` for subtree scopes |
| T-M2-02 | Person profile (FR-IAM-01 R1 fields: Arabic/English names, e-mail, mobile, employee number, job title, department, branch, direct manager, hire date, locale) | Claude | 🟢 | #30. `platform.persons` + name parts AR/EN, mobile (E.164), locale, nationality, person type, [std] via `stamp_row`, `deactivated_at` follows status; new `platform.person_employment` (branch, department, job title, grade, direct manager, hire/end dates, source) with live references and an acyclic manager chain; departments/branches with **active** people cannot be soft-deleted. Decision (Tech Lead): heads and managers who are deactivated are handled by the deactivation flow (T-M2-09: reassign department head and direct reports), not blocked in the database. Independent review: approve with fixes (2 Medium: placement could be moved to another person; reactivation into a deleted unit — 7 Low) → all fixed with tests → re-review **approve**. Note for T-M2-12 (bulk import): manager-depth check scans the moved person's reports under a per-tenant lock |
| T-M2-03 | Roles: 14 system roles + platform permission catalog + role assignments (one primary + additional, BR-IAM-1), effective grants in `defineAction`, no-escalation rule, audit with before/after (BR-IAM-3) | Claude | 🟢 | #31. ADR 0003 §3–5; security decision 4 answered 5 Oct 2026 (HR Manager: ordinary roles; Organization Admin: privileged roles; no self-assignment). Built: platform permission catalogue (13), 14 system roles in code, `ref_roles` + `role_assignments` with database guard (no self-change, privileged roles only by admins, last admin kept), provisioning + backfill give Organization Admin, grants loaded per action. Independent review: request changes (1 High: member suspension not limited by role; 4 Medium) → fixed → re-review **approve** (4 Low fixed). From T-M2-01 review: `withUserTx` retries once on deadlock (40P01) — org-structure locks can be taken in either order in long transactions; add a two-connection concurrency test (dblink) to the DB gate |
| T-M2-04 | Users list + user profile screens (read), scoped lists | Claude | 🟢 | Screens 1, 3. Split in two PRs: **04a** (#32, merged) — `defineQuery` (authorized reads for pages: same checks as actions, no audit), people scope from grants (`PersonScope`: everyone / self / direct reports / reports tree / departments with sub-departments / branches) turned into an SQL filter, users list (tabs, counts, search, role/department/branch filters, paging) and profile queries, person resource facts for `authorize()`; unit + integration tests (another organization's people never returned). Independent review: approve with fixes (2 Medium: profile activity shown without `platform.audit.read`; audit lookups scanned the whole log; 6 Low) → fixed: activity and roles only with their permissions, current roles only in the list, Arabic-aware name search (`private.search_key`: hamza/teh marbuta/alef maqsura/diacritics), two audit indexes, page size ≤ 100, and an end-to-end test proving list and profile checks agree for every role; re-review **approve**. **04b** (#33, merged) — users list (tabs with counts, search incl. Arabic digits, role/department/branch filters, paging, empty and invalid-filter states) and user profile (basic data with Hijri hire date, roles, account, recent activity) at `/[locale]/suite/admin/users[/personId]`; shared suite shell with an **Organization admin → Users** entry for members who see more than themselves; `ctx.can(permission, target)` decides roles/activity from the loaded grants; AR/EN copy; preview pages in the smoke E2E (axe, both languages, mobile); signed-in E2E with sample people in the self-hosted smoke (gate 15). Independent review: approve with fixes (2 Medium: page past the end; `aria-label` on a span; 10 Low) → all fixed: last-page redirect, screen-reader text for empty values, roles per row only where `platform.role.read` reaches (`ctx.grantsFor`), manager link only when that profile may be opened, breadcrumb label, emails in RTL, language switch keeps the filters, Hijri only for date-only values, department filter includes sub-departments (Tech Lead decision, same as the department-head scope), navigation errors logged, role dates in order; new signed-in E2E as a Line Manager + Learner (team only, 404 outside, roles of the team only, no audit trail). Re-review **approve** (2 nits fixed: «غير متاح لك» for roles the member may not read; unused message removed). Not in this task: invite/import buttons and row actions (T-M2-07/09/12), sign-in sessions, MFA and lockout on the profile (T-M2-10). Small-screen navigation suggested as a separate task |
| T-M2-04c | Visual design round: the product look follows **Jadarat LMS** (PO, 5 Oct 2026) — colors, type, spacing, cards, tables, navigation applied to the real users pages for PO approval; it becomes the design tokens; tenant colors/logo (FR-ADM-07) plug into the same tokens | Claude + PO | ✖ | **Superseded (15 Oct 2026)** by the Kawadir ATS alignment (PO, option B; `EP-SHELL-K`, `docs/design/kawadir-alignment.md`); the theming groundwork (brand theme as one swappable layer, contrast checks) is kept. Was: **On hold** — PO, 5 Oct 2026: continue the normal flow, design checked later (PO says when). Approved screens = content and flow; the look is still to be designed. **Will need from the PO:** Jadarat LMS screenshots or its brand/design guide (Claude cannot open it) |
| T-M2-05 | Roles & permissions page (read-only matrix) | Claude | 🟢 | Screen 5 · FR-IAM-07. **Done (#37, merged 6 Oct 2026)**: «الأدوار والصلاحيات / Roles & permissions» in the admin navigation for members who read the roles of the whole organization; the 14 system roles with descriptions, privileged flag and member counts (same people as the users list filtered by the role, with a «عرض المستخدمين» link); the BRD Appendix B matrix (20 areas, sensitive ones flagged, levels with qualifiers) kept in code (`role-matrix.ts`) with a test that its users-and-roles and audit rows match the permissions roles really grant; «إنشاء دور مخصص» shown as coming soon (R2). «دعوة مستخدم بهذا الدور» comes with invitations (T-M2-07). Review (approve with fixes; 1 Medium, 5 Low) → fixed: choosing a role on a phone scrolls to its details; the language switch keeps the role; own preview message; numbers in the pinned format (ADR 0007); integration test for deactivated/revoked/other-organization members; customer-facing note without the BRD reference; unknown role → plain page; settings row checked against tenant permissions. Copy question for the UX writer: level label «اعتماد» (approved screen) vs glossary «موافقة» for approvals (#80/#81) |
| T-M2-06 | E-mail delivery: notification e-mail adapter (Mailpit locally/CI, SMTP for sovereign) + provider for the regional cloud | Claude + PO | 🟢 | Provider **Resend** (PO, 6 Oct 2026), sending domain `lms.entlaqa.com`, sender «ENTLAQA LMS» <noreply@lms.entlaqa.com>. Three steps approved by the PO (6 Oct 2026): **06a** background jobs foundation — **merged (#38, 6 Oct 2026)**: transactional outbox + inbox (ADR 0004), graphile-worker runner as `app_queue` (ADR 0005; no database privilege), notification wake-up, dispatcher and deliveries, `apps/worker` (daemon / one pass), two workers in the self-hosted stack (gate 15), staging pass every 5 minutes from GitHub Actions (environment `staging-jobs`); runbook `docs/engineering/background-jobs.md`. Staging: DB deploy and `staging-jobs` set-up done with the PO (6 Oct 2026); first worker pass green. **06b** e-mail — **merged (#39, 6 Oct 2026)**: delivery log `platform.message_deliveries`, bilingual invitation template, `queueEmail`, sender with Resend and SMTP transports, `test-email` mode, Mailpit in the self-hosted stack (runbook `docs/engineering/email.md`); independent review: no Critical/High, 2 Medium + 9 Low fixed (6 Oct 2026); staging set-up done with the PO and test e-mail received (7 Oct 2026; deployment-check fix #40). Follow-up before production (Claude): sweeper for deliveries left waiting over 24 h (`failed`/`STALE`, content removed) with the delivery-log retention housekeeping. Then T-M2-07 |
| T-M2-07 | Invitations: create, resend (≤ 3), revoke, expire after 7 days; invitation e-mail (AR/EN); accept + set password (checked activation function); expired/revoked/used link states | Claude | 🟢 | Screens 2, 7, 8, 9; FR-IAM-03. The acceptance function is SECURITY DEFINER and bypasses the role/membership guards (they apply to `authenticated` only): it must allow only `invited → active` for the caller's own invitation — security review required (T-M2-03 review) |
| T-M2-08 | Forgot / reset password: no account enumeration, 60-min single-use link, other sessions ended, confirmation e-mail | Claude | 🟢 | Screens 10, 11. Merged #43 (7 Oct 2026); e-mails move to our notification service in T-M2-17 |
| T-M2-09 | Deactivate / reactivate: login blocked, sessions revoked, records kept; reassignment hook (module items join as M3/M4 ship) | Claude | 🟢 | Screen 4; FR-IAM-05. Must reassign the person's direct reports and any department they head before deactivating (T-M2-02 decision). **Built 9 Oct 2026** (agent gates green incl. smoke): membership suspended + sessions in that organization ended at once, pending invitations revoked, records and roles kept; Org Admin, or HR for non-privileged members; no self-deactivation, last active Org Admin kept; hand-over of direct reports / headed departments first (module items plug into `apps/suite/src/lib/responsibilities.ts`); reactivation only through a checked function (authenticator code for privileged members); sign-in and token refresh refused by the access-token hook for accounts with memberships but none active and no pending invitation (replaced the worker's Auth bans after the security review; HTTP 500 on internal errors, 403 only for a refusal); deactivating a privileged member needs an authenticator code. Independent security review: approve with fixes (4 Medium) → reworked → re-review **no Critical/High/Medium**; residual N2 (a pre-deactivation refresh token works again after reactivation) closes with T-M2-10's Auth-session deletion. Gates green; **#46 merged and deployed to staging 10 Oct 2026** |
| T-M2-10 | Security policy per organization: MFA enforcement (TOTP first), password policy, lockout, inactivity / max session length / max devices, active sessions + force sign-out | Claude | 🟢 | Screens 3, 6; FR-IAM-12/13; security decisions 1, 2, 5 needed here. **Built 9 Oct 2026** (10a policy + TOTP + strictest password; 10b session rules, session lists, force sign-out; agent gates green). Independent security review: 1 High (password-only set-up of a first authenticator gave AAL2), 3 Medium, 5 Low — fixes in progress with the PO's answers of 9 Oct (Org Admin resets lost authenticators, 15-minute code for high-risk actions, stricter rules at next change, "Not now" re-asked every 30 days) Final re-review **OK to open the PR**; integrated on top of merged T-M2-09 (`switch_active_tenant` keeps T-M2-09's membership lock; residual N2 closed — deactivation ends the login's Auth sessions when no other active membership remains; privileged deactivate/reactivate use the full AAL2 rule; one retry on deadlock for actions). Gates green on the integrated branch (10 Oct 2026) **Merged (#47, follow-up #48) and deployed to staging 10 Oct 2026.** |
| T-M2-11 | Sign-in rate limiting + failed sign-ins as security events (carry-over from T-M1-D03, SCS-16) | Claude | 🟢 | **Merged #49 and deployed to staging (11 Oct 2026**, DB deploy plan → apply green). **PR #49 open (11 Oct 2026)**: shared PostgreSQL rate limiter (ADR 0011), smart lock with opt-in remembered browsers, per-account code budgets (sign-in/step-up and reset page separate), lockout and code-lock e-mails, admin unlock, front proxy client address; integrated on T-M2-10; security review + re-reviews OK. DB deploy right after merge. Release blocker for real users. Also from the T-M2-15a security review: per-user limit and audit (`platform.auth.password_change_failed`) for the current-password check on My profile; pass the client IP to Auth so its per-IP limits do not count every user as the server |
| T-M2-12 | Bulk user import wizard (CSV/XLSX, FR-IAM-04) | Claude | 🟢 | **Merged #55 and deployed to staging (12 Oct 2026**, DB deploy plan → apply green; hosted "Rate limit for sign ups and sign ins" set to 300 per 5 min by the PO). **PR #55 open (12 Oct 2026).** **Integrated on main after T-M2-18 (12 Oct 2026)**: integration review M1–M3, L1 fixed; focused re-review OK (no Critical/High/Medium; N2 documented, N3 fixed; N1 → T-M2-20); all local gates green. PR after the PO's "yes"; Invitation sending limits decided (PO, 12 Oct 2026: 1/s; 5,000 a day, 200 on trial). No authenticator code to start an import (PO, 12 Oct 2026, D-IAM-01). Hosted "Rate limit for sign ups and sign ins" 300 per 5 min: set by the PO (12 Oct 2026). **Screens approved** (PO, 9 Oct 2026, `docs/design/screens/m2-user-import/`, all 13 recommendations). Build needs the file storage + malware-scanning foundation (ADR 0006) and the worker; staging scanning waits for the continuously running worker host |
| T-M2-13 | Edit a user's details (screen 3 «تعديل البيانات»): names AR/EN, e-mail, mobile, employee number, job title, department, branch, direct manager (picked from the department's managers, PO 4 Oct 2026), hire date, interface language; audited (changed field names now; before/after values with the FR-AUD-01 diff builder) | Claude | 🟢 | FR-IAM-01 · BR-IAM-3. Gap found by the PO on staging, 5 Oct 2026 (the provisioned admin shows the placeholder name "Tenant Admin" and no e-mail). Permission `platform.user.update` (HR Manager, Organization Admin). **Done (#35, merged 6 Oct 2026)**: «تعديل البيانات / Edit details» on the user profile → edit page with the approved screen 2 fields (no new screen approval: PO 6 Oct 2026); the login e-mail of a member with an account is read-only; the direct manager list shows the chosen department's managers, with «عرض مديري كل الأقسام» for all departments, and always keeps the current manager; unique e-mail/employee number, manager loops, inactive managers and deleted units shown on the field; concurrent edits refused; audit `platform.user.updated` with changed field names only, as for My profile: before/after values (FR-AUD-01) follow when the audit diff builder with field-classification redaction exists (TM-0005 AA-03, T-AUD-21) — personal data must not reach the audit log unredacted. Review (approve with fixes; 2 Medium, 7 Low) → fixed: a deleted department/branch stays selected and is kept on save (never silently cleared); a long name stored without parts is kept when no parts are entered (also in My profile); a concurrent first placement is a version conflict; hire-date/end-date and unknown-unit refusals shown on the field, hire date 1900–2100 with its Hijri equivalent; branch vs department refusals separated; the login e-mail is not sent; the action applies the manage rule too; "Saved" announced to screen readers; more tests. Shared SQL rule `private.actor_may_manage_person` (migration `20261006100000`; staging DB deploy after merge) |
| T-M2-14 | Change a user's roles on the profile (screen 3 «تعديل الأدوار»): one primary + additional roles, validity dates; HR gives ordinary roles, only the Organization Admin privileged ones (AAL2), never one's own (PO decision 5 Oct 2026); audited with before/after | Claude | 🟢 | FR-IAM-07 · BR-IAM-1 · BR-IAM-3. Same gap; database guards already exist (T-M2-03). **Done (#36, merged 6 Oct 2026)**: «تعديل الأدوار / Edit roles» on the profile → page with the primary role (radio, role descriptions) and additional roles (optional first/last days in the organization's time zone); privileged roles locked with an explanation (AAL2 always — PO decision D-IAM-01, 6 Oct 2026 — so they become changeable with MFA in T-M2-10; HR: Organization Admin only); own roles, members without an account and revoked members explained; last Organization Admin protected; audit `platform.user.roles_changed` with before/after. Database guard: HR cannot change any role of a privileged member (migration `20261006110000`; staging DB deploy after merge). Review (approve with fixes; 1 Medium, 5 Low) → fixed: a primary role keeps its days (an ended primary is no longer revived by an unrelated save); the privileged-change check runs inside the locked save against the stored roles; last days read correctly across daylight-saving changes (Cairo test); the profile shows role days in the organization's time zone; version token includes the row id; revoked members refused by the action; ended / not-started roles marked; date fields named by their visible labels, date errors per role |
| T-M2-16 | Separation of duties (BR-IAM-4, PO 7 Oct 2026), widened 8 Oct 2026: the Organization Admin holds no other role (incl. HR Manager and Learner) — refused when assigning roles (T-M2-14) and when inviting (T-M2-07), in the action layer and the database guards; existing data checked; the Organization Admin's description updated to «setup role» | Claude | 🟢 | Small; next after T-M2-08. Module permissions (M3+) must never be granted to Organization Admin (Appendix B). Follow-ups: the edit-roles and invite forms block every role next to Organization Admin whatever the dates — a scheduled hand-over (allowed by the database and the save logic) is not offered in the UI in R1 (immediate swap only); future HR/LMS sync jobs must handle the JR001 refusal per row |
| T-M2-17 | Account e-mails through our notification service (FR-NTF-02, FR-IAM-13; PO 7 Oct 2026): the reset request becomes a job; the worker (only it holds the Auth admin key — never the web app, ADR 0002 §7) creates the recovery link without Auth sending anything and queues our bilingual e-mail in the organization's language and brand (organization: the one the visitor came from, else the person's only one, else the platform sender); "password changed" notice the same way; Auth's mailer and templates become a fallback only; constant-time answer, limiter, link handling and smoke journey kept; ADR update + security review | Claude | 🟢 | After T-M2-16. Prepares FR-NTF-10/11 (R2): texts and transport per organization |
| T-M2-18 | File storage + malware scanning foundation (ADR 0006): `platform-files` package, `platform.files` metadata with RLS, private buckets, direct uploads with signed URLs (no service key in request paths), ClamAV scanning in the worker (fail closed), short-lived download grants, retention classes; Supabase Storage + ClamAV in the self-hosted stack | Claude | 🟢 | **Merged #50 and deployed to staging (12 Oct 2026**, DB deploy plan → apply green; Storage role `supabase_storage_admin` confirmed; S3 connection and image transformation off; residual risk R-58 accepted by the PO). **PR #50 open (11 Oct 2026)**, merged onto main after #49, all local gates green. Needed by T-M2-12 (import files) and T-M2-15b (profile photo), then every module. Staging scanning waits for the continuously running worker host |
| T-M2-19 | Organization structure maintained by the **HR Manager** (PO decision 11 Oct 2026, BRD v2.7 FR-ADM-04/05): move `platform.org.manage` from the Organization Admin to the HR Manager (system roles, tests, department-head reassignment on deactivation), then the branches & departments screens | Claude | 🟢 | **Part 1 merged (#56, 12 Oct 2026; no DB deploy needed; main CI green). Part 2 paused (PO, 14 Oct 2026: UI/UX first, then role by role) — continues as T-M3-02 in `EP-PLN` (15 Oct 2026).** `platform.org.manage` moved from `tenant_admin` to `hr_manager`; a leaver's departments are handed over by whoever deactivates them (`platform.user.deactivate`, PO option 1, 12 Oct 2026 — security review High: otherwise a privileged department head could not be deactivated). Part 2: the branches & departments screens (`EP-M2-TEN`); **open before part 2:** `platform.org.manage` risk/AAL2 (TM-0004 T-PEO-07 asks high + AAL2, the registry has medium) — PO decision **17 Oct 2026 (re-organization by role):** **part 2 delivered as T-M3-02** (levels, tree, heads, branches — merged in #64, live in production); the `platform.org.manage` risk question was decided by the PO (medium, no step-up — T-M3-02). |

*Moved to open work: T-M2-10c, T-M2-15, T-M2-20.*

#### `EP-OA` Organization Admin, R1 — feature list approved 14 Oct 2026 ([`roles/organization-admin.md`](roles/organization-admin.md))

Way of working (PO, 14 Oct 2026): UI first, then role by role with full features. Each task's screens are designed in the approved style (Meridian + Jadarat palette) and shown to the PO before building. R2 items follow as "Organization Admin part 2".

**⏸ Paused (PO, 15 Oct 2026):** the remaining `EP-OA` tasks wait until the planning core (`EP-PLN`) is built, then resume **in Kawadir ATS's layout** ([`docs/design/kawadir-alignment.md`](../design/kawadir-alignment.md)) in M4. Reason: the core product is organization set-up + training planning; the Organization Admin first needs only what the planning journey uses (roles — `EP-ROLES`; the shell and the existing pages moved — `EP-SHELL-K`). Task IDs are kept.

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M2-21 | Apply the approved design to the product: Jadarat theme (palette, Poppins + IBM Plex Sans Arabic bundled with the app), gradient sidebar from brand tokens, new app shell with menus per role, English default locale | Claude | 🟢 | **Merged #57 (14 Oct 2026)**, all 19 checks green; no DB deploy needed. PR opened after the PO's "yes" (14 Oct 2026). Theme light/dark (148/148 contrast pairs), organization colours drive the gradient, self-hosted fonts (OFL-1.1 exception approved by the PO), Meridian shell + modal phone drawer, Org Admin menu groups and set-up home, English default, L&D Manager label (key `training_manager` unchanged; import accepts the former names). Independent review + re-review: all findings fixed. No DB deploy needed |
| T-M2-22 | Organization profile + regional settings (#3, #4) | Claude | 🟢 | **Merged #58 (15 Oct 2026)**, 18/18 checks green; DB deploy on staging done 15 Oct 2026 (plan → apply green, 5 migrations `20261017090000…090400`). FR-ADM-02, FR-SCH-07, BR-ADM-3. **Screens approved by the PO 14 Oct 2026** (design canvas: «Organization Admin · Organization profile», EN + AR): display name AR/EN, industry, country (suggests currency/timezone/working week/date display), currency, timezone, fiscal-year start, default language; date display Gregorian/Hijri/both; working days + default working hours (branches override later). Includes a migration → DB deploy after merge |
| T-M2-29 | ~~Notification rules + channels/languages users may choose~~ | — | ✖ | Moved to the **L&D Manager** (PO, 14 Oct 2026; BRD v2.9) — planned with that role |

*Moved to open work: T-M2-23, T-M2-24, T-M2-25, T-M2-26, T-M2-27, T-M2-28, T-M2-30, T-M2-31, T-M2-32, T-M2-33, T-M2-34.*

### Build order since 15 Oct 2026

PO decisions of 15 Oct 2026 (STATUS §2): the core product is organization set-up + training planning; six standard roles + custom roles (set pending PO confirmation); Kawadir ATS's UI/UX and Organization Admin settings copied one-to-one; one production environment with automatic DB deploy; lighter process; **business flow first for every epic** (the first task of each epic below blocks the others). Order: `EP-OPS` → `EP-ROLES` → `EP-SHELL-K` → `EP-PLN` → delivery epics (M4–M6) with the paused `EP-OA` items in parallel in M4. `EP-OPS` and `EP-ROLES` can run in parallel once their flows are agreed (independent work, Development Plan §2.4 P7).

#### `EP-OPS` Production operations & automatic DB deploy (M2)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M2-35 | **Business flow agreed with the PO**: how a change reaches production (merge → app deploy → automatic DB deploy), who is told when a deploy fails and what they do, when the test environment is created | Claude → PO | ✖ | Blocks T-M2-36…38. Template: `docs/business-flows/README.md` **17 Oct 2026 (re-organization by role):** **superseded** — the PO's decisions of 15 Oct 2026 (STATUS §2: one production environment, automatic DB deploy after merge, failure issue) served as the agreed flow; EP-OPS was built in #59 without a separate flow document. |
| T-M2-36 | **Production naming in the workflows**: **DB deploy** and **Provision organization** offer the environment `production`; the jobs workflow runs in `production-jobs` (renamed from "Jobs (staging)"); uptime workflow and issue texts say production; docs and labels; check every use of the environment name in code before Vercel's `JADARAT_ENVIRONMENT` becomes `production` (error-tracking tag, client-IP rule outside Vercel); option to skip preview builds for `dependabot/*` branches (R-62); after the old project is deleted, remove the `staging` choices | Claude | 🟢 | PO decision 15 Oct 2026 (one environment while there are no customers). **Must be merged before T-M2-37 section D** (production-setup.md step 1) **17 Oct 2026 (re-organization by role):** **done — merged in #59 (15 Oct 2026)**; workflows run against `production` / `production-jobs` (session log 15–16 Oct). The `staging` choices go with T-M2-37 step 39. |
| T-M2-38 | **Automatic DB deploy after every merge to `main`**: GitHub Actions workflow on push to `main` touching `supabase/migrations/` or the deploy scripts → `plan` → `apply` only if `plan` is green → `verify-deployment.sql`; one run at a time (concurrency group), never cancelled mid-run; a failure opens or updates an issue labelled `db-deploy-auto` and merges wait until it is fixed; the manual **DB deploy** workflow stays as fallback; runbook update (`docs/engineering/db-deploy.md`); hosted-simulation test of the workflow path | Claude | 🟢 | **Decided (PO, 15 Oct 2026), to build.** Security review (workflow permissions, environment secrets only on `main`, no secrets in logs). Risk R-63. Production worker host (ADR 0005) stays a PO cost decision before the first customer **17 Oct 2026 (re-organization by role):** **done — merged in #59 (15 Oct 2026)**; `DB_DEPLOY_AUTO=on` (16 Oct); automatic deploys green after #61, #63 and #64. |

*Moved to open work: T-M2-37.*

#### `EP-ROLES` Standard roles & custom role builder (M2)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M2-39 | **Business flow agreed with the PO**: who does what in the R1 journey, using the mandatory-roles analysis (`roles/README.md` §3); **PO confirms the six standard roles**, the Arabic labels («مدير المنظمة», «موظف») and the open questions Q1–Q3 (Instructor as a 7th role, direct managers without a department, plan approvers) | Claude → PO | 🟢 | **Agreed (PO, 17 Oct 2026)**: `docs/business-flows/EP-ROLES-roles-and-custom-roles.md` — option B (Kawadir's fixed standard roles + our custom role builder), one role per person, Instructor as a template, line managers from the reporting line, named plan approvers, labels «مدير المنظمة» / «موظف». BRD v3.1 |
| T-M2-40 | **Six standard roles**: role registry and database roles, permissions per BRD v3.0 Appendix B, privileged = Organization Admin, HR Manager and roles with a high-risk permission; **migration of existing assignments** to the nearest standard role (`roles/README.md` §4, dry-run counts in `plan`, nobody gains permissions, BR-IAM-4 and last-admin guard kept, audited); roles page updated; authorization negative tests per role; RLS unchanged | Claude | 🟢 | FR-IAM-07, BR-IAM-1/3/4. Replaces the 14 system roles of T-M2-03. **Built on the EP-ROLES branch (17 Oct 2026), with T-M2-41 in one PR:** six standard roles (codes kept), the 8 former roles retired from `ref_roles`; **one role per person** (unique index, invitations without additional roles; migration keeps one row per member — continuing role, Organization Admin, primary — and maps former roles to Employee, counts in the deploy log); permission catalogue in the database (`ref_permissions`, `ref_role_permissions`) and the database guards decide by permission; invite / Edit role dialog / person page use one Role select; Docker seeds updated. Reviewed (code + security, all findings fixed); **merged in #63 (17 Oct 2026)** |
| T-M2-41 | **Custom role builder** (R1): create, edit, delete custom roles — name AR/EN, description, permissions grouped by module with high-risk flags, one data scope per role (own, direct reports, reports tree, headed departments, organization); templates for the former roles (BRD Appendix B); roles in use protected; no escalation (only an Organization Admin creates or assigns a privileged role; nobody grants a permission they cannot grant); audited with before/after; RLS + cross-tenant tests for the new tables | Claude | 🟢 | FR-IAM-07, FR-IAM-08 (R1 note). Screens in the Kawadir layout, approved in one batch with `EP-SHELL-K`. Security review (privilege escalation, TM-0003 update). **Built (17 Oct 2026):** `custom_roles` / `custom_role_permissions` (forced RLS, restrictive tenant isolation, cross-tenant pgTAP), rules in the database and the actions (Organization Admin only builds roles; no permission given that the actor lacks; privileged = any high-risk permission, given only by the Organization Admin; delete refused while held, with counts); scopes own / their team / their departments / organization (administrative permissions need organization); templates Instructor, Finance approver, Line Manager, Compliance Officer, Auditor; Roles & permissions table, Create / edit role pages with the permissions accordion; audit `platform.role.created/updated/deleted`. Screens to approve (Storybook *Theme preview/Roles*); reviewed; **merged in #63 (17 Oct 2026)**. **Who can give what (PO, 17 Oct 2026) implemented** (migration `20261020200000_platform__who_can_give_what`, replacing "no permission given that the actor lacks"): the Organization Admin builds custom roles with any catalogue permission — also the course, planning and needs-form ones it does not hold — never role management, privileged role assignment or the organization structure (`platform.org.manage` now `custom_role_use = none`); the HR Manager (`platform.role.assign`) gives every ordinary role (L&D Manager, Training Coordinator, Department Head, Employee, ordinary custom roles) on invite, Edit role, import and invitation acceptance; privileged roles only by the Organization Admin; needs-form permissions usable in custom roles (read: any scope, manage: organization only); DB + app + pgTAP/unit tests; TM-0003 §1.6. Security review pending **17 Oct 2026 (re-organization by role):** the who-can-give-what security pass ran and its fixes were merged in #64 (session log 17 Oct). |

#### `EP-SHELL-K` Kawadir-style shell (M2)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M2-42 | **Business flow agreed with the PO**: navigation per role — which menu groups and items each of the six roles sees, the Organization Admin's Organization / Billing / Settings groups (`docs/design/kawadir-alignment.md` §5) and where Roles and Security sit | Claude → PO | ✖ | Blocks T-M2-43 **17 Oct 2026 (re-organization by role):** **superseded** — menus per role follow `docs/design/kawadir-alignment.md` §5 and the PO's choices of 15–16 Oct (Organization / Billing / Settings; Roles and Security placed as built); the PO approved the shell on 16 Oct («everything else is perfect»), merged in #61. |
| T-M2-43 | **Kawadir-style shell and page patterns**: tokens (radius 0.75rem, soft shadows, muted background, 135° gradient), white collapsible sidebar 260↔72 px with organization logo, gradient on the selected item and «Powered by Jadarat»; sticky top bar (title, ⌘K command palette, full-screen, light/dark/system theme, language, bell, avatar "Org · Role"); Card + Table lists, dialogs, sonner toasts, empty states; existing pages moved: Users → **Team members** (summary cards, Members / Pending invites tabs), Organization profile → **Settings → General**, roles page, security, My profile; screens approved in one batch | Claude + PO | 🟢 | FR-STE-08, FR-ADM-02, FR-IAM-01…05. Supersedes the gradient sidebar of T-M2-21; axe-gated Storybook and E2E stay. Built on branch `kawadir-shell` (16 Oct 2026, not pushed): shell, patterns, Team members, Settings → General at `/suite/admin/settings` (old URL redirects); one read added (primary role for the account menu, no migration). Waiting: PO screen batch approval; menu placement per T-M2-42 **17 Oct 2026 (re-organization by role):** **merged in #61 (16 Oct 2026)** (was 🔵); the screen batch approval was replaced by the PO's review of the side-by-side comparisons and, since 17 Oct, by no screen approval at all. |

#### `EP-KAW-AUTH` Sign-in, invitations and Super Admin — Kawadir way (M2)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M2-44 | **Kawadir sign-in and invitation codes**: two-step sign-in (e-mail → password), join with code `/sign-up`, invitation codes issued by the database (12 characters, 7 days, single use), Copy code / Copy invite link after inviting and in Pending invites, resend = new code, forgot/reset password restyled; no e-mail required | Claude | 🟢 | FR-IAM-03, FR-IAM-12/13. Business flow agreed (PO, 16 Oct 2026). Security review done; fixes done on the branch (H1 12-character codes shown XXXX-XXXX-XXXX + all-clients limit + IPv6 /48, M1 readiness list, M2 codes read on demand and audited, M3 announced states, Lows) — confirmation look on the High fix next **17 Oct 2026 (re-organization by role):** **merged in #61 (16 Oct 2026)** (was 🔵); migrations live through the automatic DB deploy; accepted end to end in production (guided test 17 Oct). |
| T-M2-45 | **Platform Super Admin console**: Super Admin by user ID (Platform admin workflow), Platform → Organizations (list, Create organization with the Organization Admin e-mail → code/link to copy, new code), platform audit | Claude | 🟢 | FR-ADM-17, ADR 0013. Security review done (no Critical/High); fixes done on the branch (M1 reissue replaces another issuer's invitation + `issuer_revoked` state, L1–L9). MFA open (R-65) **17 Oct 2026 (re-organization by role):** **merged in #61 (16 Oct 2026)** (was 🔵). Console MFA (R-65), status, health, announcements and impersonation → WP-SA-01; platform e-mail settings → WP-ADM-01. |

#### `EP-PLN` Planning core (M3) — BRD v3.0 §5.4

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M3-01 | **Business flow agreed with the PO**: the planning cycle end to end — structure and department heads → course library → cycle set-up (period, deadline, scope, budget envelopes) → Department Head needs → consolidation and budget check → plan approval chain → locked plan → hand-over to delivery; exceptions (late or missing department forms, budget exceeded, rejected lines, a department head who leaves) | Claude → PO | 🟢 | **Agreed (PO, 17 Oct 2026)**: `docs/business-flows/EP-PLN-planning-cycle.md`, all 18 open questions approved; structure levels and department-limited roles in `EP-ORG`. Unblocks T-M3-02…09; T-M3-08 built with scheduling at the start of M4 (Q18). Includes a short threat note for the new tables (department scope, approval integrity) |
| T-M3-02 | **Organization structure with department heads** (HR Manager): **levels defined by each organization** (ordered, AR/EN names, up to 10, default one level Department), branches and structure tree screens («Add <next level>»), head per unit, in the Kawadir layout | Claude | 🟢 | FR-ADM-04, 05. Business flow agreed (PO, 17 Oct 2026): `docs/business-flows/EP-ORG-organization-structure.md`. Continues T-M2-19 part 2. **Built (17 Oct 2026, branch not pushed; awaiting review):** `platform.structure_levels` (RLS + cross-tenant tests; default level Department / «إدارة» for every new organization, also through the Super Admin console; backfill for existing trees; added at the bottom, renamed any time, only the last unused level removed; writes need `platform.org.manage`, also in the RLS write policies) and `departments.level_ordinal` (computed = depth; no unit below the last level; moves cascade) — migrations `20261020090000…090300`; Organization → Structure (tree with «Add <next level>», head picker = active people, deactivate, delete refused with counts) and Levels view, Organization → Branches (FR-ADM-04 core fields); audit `platform.org.level_*` / `unit_*` / `branch_*`; pgTAP (`99_structure_*`), unit, authorization-negative and E2E (EN/AR) tests. **Decided (PO, 17 Oct 2026):** `platform.org.manage` keeps risk **medium**, no step-up (MFA off by default since the D-IAM-01 reversal). Moving a unit to another parent (BR-ORG-e) is supported by the database but has no screen yet; drag-and-drop order, cost centre and CSV import (FR-ADM-05) not built **Review fixes (17 Oct 2026):** S-M1 — the database now refuses unit and branch inserts/updates without `platform.org.manage` (migration `20261020210000`); the leaver head hand-over (`platform.user.deactivate`) may change `head_person_id` only (guard `private.check_department_writer`); pgTAP for Employee, L&D Manager, department-limited role holder, HR and the hand-over; system jobs no longer write the structure. C-9 — a new headquarters audits the previous one's flag change. S-L4 — `platform.org.manage` medium/no AAL2 recorded as risk R-69 (revisit with R-65). **C-8 note:** moving a unit (BR-ORG-e) still needs its UI; when it is built, remember the cascade bumps `version` of every unit below the moved one (`private.cascade_department_level`) — an open edit dialog on such a unit then meets a version conflict; the move preview should list the units and role assignments affected (TM-0004 T-PEO-07). **Merged in #64 (17 Oct 2026), live in production.** |
| T-M3-03 | **Course library** (L&D Manager, Training Coordinator edits; **not a planning prerequisite — PO, 17 Oct 2026: courses are created from the approved plan**; «Create course from plan line» comes with T-M3-08): code, AR/EN title, description, category, delivery type, duration, min/max participants, estimated cost for planning; search with Arabic normalization | Claude | 🟢 | FR-CAT-01, 10 (minimal); templates, prerequisites, objectives and materials (CAT-02, 03, 05, 06) follow in M4. **Built (17 Oct 2026, awaiting review/PR):** migrations `20261020120000` (permissions `tms.course.read`, `tms.course_cost.read`, `tms.course.manage`, `tms.course.archive` in the catalogue, «Courses» group of the role builder) and `20261020120100` (`tms.course_categories`, `tms.courses`: archive not delete, costs stamped with the organization's currency, guards by permission); Courses page (`/suite/courses`: summary cards, Arabic-aware search, filters, add/edit dialog, archive/restore); course creation is a reusable service (`createCourse`) for later plan-line pre-fill (T-M3-08). Grants: L&D Manager all, Training Coordinator add/edit, HR Manager and Department Head read + costs, Organization Admin none. **PO decisions open:** Employee «V» deferred to M4 (granting it now would stop custom roles with role.assign from giving the Employee role); HR Manager can no longer give the L&D Manager / Training Coordinator roles (nobody gives a permission they do not hold); the Organization Admin cannot put training permissions in custom roles (same rule) **Review fixes (17 Oct 2026):** C-M2 — course actions answer without estimated costs to callers lacking `tms.course_cost.read` (the audit keeps the full rows); the course guards' actor check moved to `private.course_library_actor` (migration `20261020210400`); database-level cost-column restriction deferred to FR-CAT-02 — accepted risk R-68. **Merged in #64 (17 Oct 2026), live in production.** **17 Oct 2026 (re-organization by role):** the «PO decisions open» above were settled by the who-can-give-what rule (#64: HR gives the L&D Manager / Training Coordinator roles again; the Org Admin may put training permissions in custom roles). Still open: Employee «V» on courses → WP-LD-05; tags → WP-LD-05. |
| T-M3-04 | **Planning cycle** set-up: name, period, deadline, scope (departments/branches), budget envelope per department, reminders; states Draft → Open → Closed → Consolidated | Claude | 🟢 | FR-PLN-02; Appendix C "TNA campaign" status model. **Built, not reviewed (17 Oct 2026; business flow steps A3, B4–B5, C9):** Planning → Cycles (Kawadir Requisitions layout: summary cards, status tabs), cycle set-up full page (Basics with a «Needs form» choice, Scope, Budget, Approval chain with named approvers, Reminders; draft edit/delete; Launch), cycle progress (one row per department, all «Not started» until the needs form exists; Late after the deadline; extend deadline while open), Planning settings (default reminders and chain). Migrations `20261020150000` (permissions `tms.plan_cycle.read` L&D Manager + Training Coordinator, `tms.plan_cycle.manage` L&D Manager), `20261020150100` (planning settings), `20261020150200` (cycles, scope, departments, steps; state guard; one open cycle per organization — Q1; BR-PLN-g; `needs_form_id`; **wired to the needs forms library at integration (17 Oct 2026, migration `20261020190000`):** composite FK to `tms.needs_forms`, default form on a new cycle, launch requires the form and locks it in the same transaction (database guard), a form a cycle uses cannot be deleted; pgTAP `99_planning_c_*`). pgTAP `99_planning_*`, unit + integration tests, E2E EN/AR (`planning.spec.ts`; data journey `planning-journey.spec.ts` not yet wired into the self-hosted smoke). **Open:** «Send reminder» and reminder sending need in-app notifications (FR-NTF-01) — TODO; open cycles past their deadline are closed on the next launch (no scheduled job yet); HR Manager can no longer give the L&D Manager / Training Coordinator roles (EP-ROLES rule «nobody gives a permission they do not hold» — PO decision pending with the tech lead) **Review fixes (17 Oct 2026):** S-L3 — planning cycles, their scope/departments/steps and the planning settings are read with `tms.plan_cycle.read`/`.manage` only (migration `20261020210300`; TODO(T-M3-05): department-scoped read for Department Heads); C-7 — an open cycle's deadline can be extended after it passed (to today or later; migration `20261020210600`, the date input starts at max(deadline + 1, today) — C-11); C-M3 — approvers are searched by name on the server (min 2 letters, at most 50) and validated by id without a cap (PLANNING_E2E_APPROVER_SEARCH for the data journey); C-6 — no «none» needs form, the cycle's own form stays listed when switched off; C-10 — the «created» audit records the stored needs form. **Merged in #64 (17 Oct 2026), live in production.** **17 Oct 2026 (re-organization by role):** open items → **WP-PLT-01** (reminder sending, «Send reminder», automatic closing after the deadline) and **WP-LD-01** (department-scoped read for Department Heads, real progress states). Labels with the organization's level names → WP-FIX-01. |
| T-M3-10 | **Customizable needs form (form builder)** — L&D Manager: forms library (create, duplicate, set default, switch off; default form seeded per organization), builder (sections incl. repeatable with min/max; 12 field types; AR/EN labels and options; required; shown/hidden; one show-if condition; move up/down), system fields always present (training topic; number of people / named employees), form chosen per cycle and locked at launch; server-side validation of answers against the form; answers keyed by field ID | Claude | 🟢 | FR-PLN-02, FR-PLN-03 (PO, 17 Oct 2026, copied from Kawadir's application form builder with three fixes). Blocks T-M3-05 (the needs page renders the cycle's form). **Built (17 Oct 2026, branch not yet merged):** `tms.needs_forms` / `needs_form_sections` / `needs_form_fields` with RLS and database guards (designer only, system fields, one default, conditions, one-way lock), default form seeded for every organization (trigger + backfill), permissions `tms.needs_form.read` (L&D Manager, Training Coordinator) / `.manage` (L&D Manager); Planning → Needs forms library and builder with live preview (reusable renderer), answer validator in `modules/tms` for the needs page; pgTAP, unit, integration and E2E (EN/AR). **To wire at integration:** the cycle launch calls `private.lock_needs_form(form_id)` and references the form by foreign key; the role-giving rule vs. training permissions (HR Manager cannot give the L&D Manager / Training Coordinator role until the rule change — PO) **Review fixes (17 Oct 2026):** S-L1 — only `tms.plan_cycle.manage` (the launch) locks a form (migration `20261020210100`); S-L2 — the answer validator names nobody without the head's team (deny by default), returns at most 50 errors and cuts unknown keys short, and every code has an English and Arabic message (unit test), the renderer falls back to the generic message; the console's seeding writes only into the form it just created (migration `20261020210200`). **Merged in #64 (17 Oct 2026), live in production.** |
| T-M3-09 | **Department-limited custom roles**: custom-role scope «A department» replaces «their departments»; **one unit picked when the role is given** (invite, Edit role; tree picker), access covers the unit and everything under it; unit stored on the assignment, checked in the database; RLS + cross-department tests; audited | Claude | 🟢 | FR-IAM-07, FR-IAM-08 (R1 note, BRD v3.2). Business flow `EP-ORG` (PO, 17 Oct 2026). **Built (17 Oct 2026, branch not pushed; awaiting the security review — scope = access):** `role_assignments.scope_unit_id` and `invitations.scope_unit_id` (migration `20261020090400`, expand-first: stored code stays `departments`, its meaning changes in the app; a department-limited role without a unit grants nothing scoped); only such roles take a unit, a live active unit of the same organization (database + app), carried on acceptance; a unit that is a role's scope cannot be deleted; unit picker (tree order with level names) on Invite, Team members → Edit role and the edit-role page; access = the unit and everything under it (`org_units` with descendants), a deactivated unit grants nothing and the team list warns; database guards still count organization-wide permissions only; audit carries the unit; pgTAP, rbac unit, PostgreSQL integration (people list = single-person check) and signed-in E2E (users.spec) tests **Review fixes (17 Oct 2026):** C-M1 — a custom role cannot leave «A department» while members or pending invitations hold it with a unit (JR004 / SCOPE_UNITS_IN_USE with the numbers, EN/AR), acceptance drops a unit the role no longer takes, and the unit delete guard and the structure page count only roles still limited to a department (migration `20261020210500`); C-12 — the unit picker says «You can't see the organization structure» when the giver lacks `platform.org.read`. **Merged in #64 (17 Oct 2026), live in production.** |

*Moved to open work: T-M3-05, T-M3-06, T-M3-07, T-M3-08.*
