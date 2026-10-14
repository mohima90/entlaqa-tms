# Organization Admin — approved feature list

| | |
|---|---|
| **Role** | Organization Admin (Tenant Admin, مدير المنشأة) — BRD §4.2, Appendix B |
| **Approved** | PO, 14 Oct 2026 ("approved with your recommendations") |
| **Scope rule** | Sets up the organization on the IT and branding side, then hands it over to HR. No training features; holds no other role (BR-IAM-4) |
| **Build plan** | `BACKLOG.md` → `EP-OA` (T-M2-21 … T-M2-34) |

Status: ✅ built · ◐ partly built · ○ not built (14 Oct 2026). Release from the BRD.

## Decisions taken with the list (PO, 14 Oct 2026; BRD v2.8)

1. **Order:** all **R1** features first (complete Organization Admin for a first customer), then the **R2** features as "Organization Admin part 2", R3 later.
2. **Approval workflows** (FR-WFL-01/02) are configured by the **Training Manager**; **notification rules** (FR-NTF-07) by the Organization Admin.
3. **Setup wizard** (FR-ADM-01) ends with "invite your Training Manager"; the first course and first session are the Training Manager's first-sign-in steps.

## Features

| # | Area | Feature | BRD | Release | Status |
|---|---|---|---|---|---|
| 1 | Home | Admin home: users by status, usage vs. limits, integration health, AI spend, pending invitations, last 10 audit events, quick actions | FR-ADM-14 | R1 | ○ |
| 2 | Setup | Self-service sign-up and setup wizard: organization → branding → first users → invite the Training Manager | FR-ADM-01 | R1 | ○ |
| 3 | Setup | Organization profile: legal names AR/EN, CR no., VAT no., industry, country, currency, timezone, default language, fiscal-year start, authorized signatory | FR-ADM-02 | R1 | ○ |
| 4 | Setup | Regional settings: Gregorian / Hijri / dual dates, default working week | FR-SCH-07, BR-ADM-3 | R1 | ○ |
| 5 | Setup | Feature toggles for the organization's users (within the edition) | FR-ADM-13 | R1 | ○ |
| 6 | Setup | Custom fields (users, courses, sessions, enrollments, instructors, vendors, venues) | FR-ADM-11 | R1 | ○ |
| 7 | Setup | Terminology overrides | FR-ADM-12 | R2 | ○ |
| 8 | Setup | Legal entities | FR-ADM-03 | R3 | ○ |
| 9 | Setup | Sandbox tenant; configuration export/import | FR-ADM-15/16 | R3 | ○ |
| 10 | Branding | Brand identity: logo variants, primary/secondary/accent colours, fonts from an approved list, WCAG contrast warning (drives the sidebar gradient and accents) | FR-ADM-07 | R1 | ○ |
| 11 | Branding | Branded e-mails (logo, colours, sender name, language) | FR-NTF-02 | R1 | ◐ |
| 12 | Branding | Theme builder with live preview, presets, dark mode | FR-ADM-08 | R2 | ○ |
| 13 | Branding | Custom sign-in page | FR-ADM-09 | R2 | ○ |
| 14 | Branding | Custom domain with DNS wizard and SSL | FR-ADM-10 | R2 | ○ |
| 15 | Users | Users list and profile | FR-IAM-01 | R1 | ✅ |
| 16 | Users | Invite, resend, revoke, expiry ✅; organization's own invitation wording ○ | FR-IAM-03 | R1 | ◐ |
| 17 | Users | Bulk import (CSV/XLSX) | FR-IAM-04 | R1 | ✅ |
| 18 | Users | Edit a user's details | FR-IAM-01 | R1 | ✅ |
| 19 | Users | Deactivate / reactivate with hand-over | FR-IAM-05 | R1 | ✅ |
| 20 | Users | More profile fields: gender, date of birth, employment category, grade, nationality, photo | FR-IAM-01/02 | R1 | ◐ |
| 21 | Users | Groups and dynamic audiences | FR-IAM-06 | R2 | ○ |
| 22 | Users | Non-employee users | FR-IAM-15 | R2 | ○ |
| 23 | Roles | 14 default roles; role assignment with dates | FR-IAM-07 | R1 | ✅ |
| 24 | Roles | Roles & permissions overview | FR-IAM-07 | R1 | ✅ |
| 25 | Roles | Custom roles; remove/restore unused system roles | FR-IAM-07 | R2 | ○ |
| 26 | Roles | Data scopes per role | FR-IAM-08 | R2 | ○ |
| 27 | Roles | Separation-of-duties rules (Org Admin held alone ✅) | FR-IAM-09 | R2 | ◐ |
| 28 | Security | MFA with authenticator app + organization policy | FR-IAM-12 | R1 | ✅ |
| 29 | Security | Password policy, lockout, session limits, active sessions, force sign-out | FR-IAM-13 | R1 | ✅ |
| 30 | Security | E-mail and SMS one-time codes, trusted devices (T-M2-10c) | FR-IAM-12 | R1 | ○ |
| 31 | Security | SSO (SAML/OIDC), force SSO | FR-IAM-10 | R2 | ○ |
| 32 | Security | SCIM provisioning | FR-IAM-11 | R3 | ○ |
| 33 | Security | IP allow-list, access hours | FR-IAM-13 | R3 | ○ |
| 34 | Notifications | Notification rules per event: recipients, channels, timing, quiet hours | FR-NTF-07 | R1 | ○ |
| 35 | Notifications | Channels and languages users may choose | FR-LRN-07 | R1 | ○ |
| 36 | Notifications | Edit e-mail texts AR/EN | FR-NTF-10 | R2 | ○ |
| 37 | Notifications | Organization's own mail server | FR-NTF-11 | R2 | ○ |
| 38 | Notifications | SMS and WhatsApp sender setup | FR-NTF-03/04 | R2 | ○ |
| 39 | Integrations | LMS connection: Jadarat LMS wizard, SSO, mapping, sync schedule, health | FR-LMS-01/02/03/10 | R1 | ○ |
| 40 | Integrations | HR system: CSV/SFTP sync (R1), connectors (R2) | FR-INT-01 | R1/R2 | ○ |
| 41 | Integrations | Standalone or HR Suite mode | FR-STE-01 | R1 | ○ |
| 42 | Integrations | API keys, OAuth apps, webhooks | FR-INT-02/03 | R2 | ○ |
| 43 | Integrations | AI governance settings | FR-AI-10 | R2 | ○ |
| 44 | Audit & privacy | Audit log screen: search, filter, export (events recorded ✅) | FR-AUD-01 | R1 | ◐ |
| 45 | Audit & privacy | Consent settings | FR-AUD-05 | R1 | ○ |
| 46 | Audit & privacy | Data export | FR-AUD-02 | R2 | ○ |
| 47 | Audit & privacy | Data subject requests | FR-AUD-04 | R2 | ○ |
| 48 | Audit & privacy | Retention, legal hold, data cleanup | FR-AUD-03/06 | R3 | ○ |
| 49 | Subscription | Plan and limits overview | FR-SUB-01 | R1 | ○ |
| 50 | Subscription | Usage alerts, online billing, invoices, add-ons | FR-SUB-02/03/05 | R2/R3 | ○ |
