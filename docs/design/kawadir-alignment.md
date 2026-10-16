# Kawadir ATS alignment — conventions adopted by Jadarat TMS

| | |
|---|---|
| **Decision** | PO, 15 Oct 2026 — **option B**: Jadarat TMS stays a separate codebase but copies **Kawadir ATS's UI/UX and Organization Admin settings one-to-one** |
| **Kawadir ATS** | ENTLAQA's sister product (applicant tracking), private repository `ENTLAQA-UAE/kawadir-ats`; same stack: Next.js 16, Supabase, shadcn/ui (style *new-york*), Tailwind CSS v4, Poppins + IBM Plex Sans Arabic |
| **Source** | A study of Kawadir's code by the Tech Lead (15 Oct 2026). This page **describes** the conventions; no code, assets or secrets are copied into this repository |
| **Requirements** | BRD v3.0: FR-ADM-02 (General), FR-ADM-07 (Branding), FR-ADM-10 (Domain, R2), FR-NTF-11 (Email integration, R1), FR-IAM-03 (Team members), FR-STE-08 (suite shell) |
| **Build plan** | `docs/delivery/BACKLOG.md` → `EP-SHELL-K`; paused Organization Admin items resume in this layout after the planning core |
| **Supersedes** | Parts of the "Meridian" design approved on 14 Oct 2026 (STATUS decisions): the **gradient sidebar** becomes a white sidebar whose *selected item* carries the gradient; fonts, palette tokens and the organization-colour mechanism stay |

## 1. Why

The PO wants the two ENTLAQA products to look and behave alike, so that customers and ENTLAQA staff recognise them, and so that design work is not repeated (one of the causes of slow progress named on 15 Oct 2026). Option B keeps the codebases separate (different domains, data and release cycles) and copies only the conventions.

## 2. Design tokens

| Token | Kawadir convention adopted | Notes for Jadarat |
|---|---|---|
| Fonts | Poppins (Latin), IBM Plex Sans Arabic (Arabic) | Already bundled (T-M2-21, OFL-1.1) |
| Radius | Cards and inputs `rounded-xl`; base radius **0.75rem** | Update `docs/design/tokens/` and the Tailwind preset |
| Shadows | Soft, low-contrast shadows on cards | Replace heavier elevation levels |
| Page background | Muted (light grey) behind white cards | Same in dark mode with the dark muted surface |
| Brand gradient | **135°** from primary to secondary colour | Used on the selected sidebar item and primary accents; the organization's colours replace Jadarat's (FR-ADM-07 "use gradient" switch) |
| Components | shadcn/ui, style *new-york* | Our `packages/ui` wraps the same primitives; keep the axe-gated Storybook (CI gate 8) |
| Theme | Light, dark and **system** | Add "system" to the existing light/dark switch |

Contrast stays enforced by the existing token tests (WCAG 2.2 AA for every theme and organization colour).

## 3. Layout (app shell)

**Sidebar** — white, collapsible **260 px ↔ 72 px** (icons only when collapsed, tooltips on hover); the **organization logo** on top; menu groups with headings; the **selected item** filled with the brand gradient (135°) and white text; footer «Powered by Jadarat». On phones the sidebar opens as a drawer (keep the modal drawer of T-M2-21). Logical properties only: the sidebar sits at the inline start (right in Arabic).

**Top bar** — sticky, on the page background; page title; **⌘K / Ctrl K command palette** (search pill, placeholder centred); theme (light / dark / system); language toggle (globe icon, English ⇄ العربية); notification bell; account chip (photo or initials, online dot, name and "**Organization · Role**", chevron) opening My profile and sign-out. No full-screen toggle (Kawadir's screens have none; removed in the visual polish, 16 Oct 2026).

**Visual polish (PO, 16 Oct 2026)** — values copied from Kawadir's screens, colours from our tokens: the vivid brand gradient (deep sky → deep orange; an organization's colours replace it) with a coloured glow on the selected item and primary buttons; the organization's logo — or its name as a gradient wordmark — in a 96 px logo area; vivid summary cards (violet, green, orange, blue `stat-*` tokens, white text ≥ 4.5 : 1) plus white target cards with a progress bar; pill inputs; card headers with a coloured icon; gradient dashboard title. Storybook «Pages/Organization Admin» shows the screens with sample data.

## 4. Page patterns

| Pattern | Convention |
|---|---|
| Lists | shadcn **Table inside a Card**; toolbar with search and filters above; pagination below |
| Create / edit | **Dialogs** for short forms; a full page only for long forms (e.g., planning-cycle set-up) |
| Feedback | **sonner** toasts for success and errors of actions; inline field errors in forms |
| Empty states | Icon + title + one line of text + primary call to action |
| Summary | Small stat cards at the top of overview pages (e.g., Team members) |
| Settings pages | Card per section, save button per card |

Accessibility rules do not change: keyboard paths, focus return after dialogs, screen-reader labels, RTL mirroring rules (`design-principles.md`).

## 5. Organization Admin menu

Kawadir groups the Organization Admin's menu in three groups; Jadarat TMS keeps them and adds only TMS-specific items:

| Group | Kawadir items (kept) | Added by Jadarat TMS |
|---|---|---|
| **Organization** | Team members, Branding, … | Roles & permissions (custom role builder, FR-IAM-07)¹ |
| **Billing** | Subscription | — |
| **Settings** | General, AI configuration, Integrations, Email integration, Domain | LMS connection, HR system, Custom fields, Audit log, Security¹ |

¹ Placement proposed by the Tech Lead; confirmed in the `EP-SHELL-K` screen batch. AI configuration (FR-AI-10) and Domain (FR-ADM-10) are R2: shown as «قريبًا / Coming soon» until built, or hidden — PO choice in the screen batch.

Other roles get their own menus in the same shell (HR Manager, L&D Manager, Training Coordinator, Department Head, Employee); their items follow the business flows of each phase.

## 6. Settings pages

| Page | Contents (Kawadir) | Jadarat requirement |
|---|---|---|
| **General** | Regional settings: time zone, language, date display, currency, fiscal year, working week (plus industry and country, which drive the presets) | FR-ADM-02, FR-SCH-07, BR-ADM-3 — the built "Organization profile" (T-M2-22) becomes this page; organization names move to Branding |
| **Branding** | Organization names AR/EN, logo, favicon, login page image, primary + secondary colour with a "use gradient" switch, preset colour sets, website | FR-ADM-07 (T-M2-23, paused) |
| **Email integration** | One page: the **platform sender** by default, or the organization's own provider — **Resend, SMTP, SendGrid, Mailgun, Microsoft 365 / Graph**; from name, from address, reply-to; **test send** | FR-NTF-11, moved to **R1** (PO, 15 Oct 2026); FR-NTF-02 sending part |
| **Domain** | Product subdomain and custom domain with DNS verification | FR-ADM-10 (R2 unless the PO decides otherwise) |
| **Team members** | Summary cards; tabs *Members* and *Pending invites*; invite dialog; for each pending invitation the **invitation link and code** to copy, and resend | FR-IAM-01…05 (existing pages restyled), FR-IAM-03 |
| **Subscription** | Plan, limits and usage | FR-SUB-01 |
| **AI configuration** | Provider, model, usage caps | FR-AI-10 (R2) |

Credentials entered on these pages (e-mail provider keys, SMTP passwords) are write-only and encrypted so that only the worker can read them (ADR 0008, FR-NTF-11); they are never shown again or logged.

## 7. Labels

| Item | Kawadir | Jadarat today | Status |
|---|---|---|---|
| Organization Admin (Arabic) | «مدير المنظمة» | «مدير المنشأة» | **Proposed, pending PO confirmation**; glossary updated after the decision |
| Product footer | "Powered by Kawadir" | "Powered by Jadarat" | Adopted |

## 8. Sign-in and invitations (PO, 16 Oct 2026)

"Implement what is in Kawadir ATS for sign-in and invitation **exactly**; no e-mail needed — a copyable link like Kawadir." Built in FR-IAM-03 (migration `20261018090000`, design record `docs/engineering/invitations-contract.md` §0):

| Kawadir | Jadarat TMS |
|---|---|
| Login: split page — form column (logo, portal line, «Welcome back», glass card) and a brand panel; **e-mail first, then the way in**; «Forgot?» next to the password label; floating language switch | `/[locale]/sign-in` in the same layout (`components/auth/auth-shell.tsx`, Jadarat tokens); password only for now — the e-mailed code joins with the platform sender; the last method is remembered per browser. All sign-in protection (T-M2-11), MFA (T-M2-10) and non-disclosing errors unchanged |
| Forgot / reset password: form column + half-width brand panel | `/[locale]/forgot-password`, `/[locale]/reset-password` restyled; behaviour unchanged (T-M2-08) |
| Team → *Pending invites*: 8-character code (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 7 days), **Copy code**, **Copy invite link**, regenerate (resend), cancel | Users → *Invited* tab rows in the same layout; a panel with the code and the link right after inviting; codes issued by the database, readable only by members who may manage the invitation. **Deviation (security review H1/M2, 16 Oct 2026):** our codes are **12** characters of the same alphabet (60 bits), shown `XXXX-XXXX-XXXX` (typed with or without the hyphens); a row's code is fetched when copied (audited), not printed in the list |
| `/signup?code=…`: code locked when it came with the link, organization, e-mail pre-filled and locked, name, password | `/[locale]/sign-up#code=…` (the code in the **fragment**, never in server logs); typed codes too; display names AR/EN, password rules and privacy acknowledgement as before |
| Existing account: sign in, then "Join with invite" | "Sign in to accept" on the same page (unchanged) |

## 9. What does not change

Tenant isolation, RLS and authorization rules; the AR/EN copy process (UX-writer review, glossary); English as the default language for now (PO, 14 Oct 2026) with Arabic fully supported; the self-hosted (sovereign) build; WCAG 2.2 AA in both languages.
