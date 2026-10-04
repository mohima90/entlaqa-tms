# M2 — Users & roles screens (approved)

> **Status:** Approved by the PO on 4 Oct 2026 · Epic `EP-M2-IAM` · Requirements FR-IAM-01, 03, 05, 07, 12, 13 · BR-IAM-1, BR-IAM-3
> **Source:** design canvas reviewed by the PO (private). The files here are copies kept as the build reference.

Each `.dc.html` file is one screen in the design-canvas format (HTML with `{{ }}` bindings; it needs the canvas runtime to render the interactive parts). Read the markup for layout, copy and states. The names, e-mails and numbers are sample data.

| # | File | Screen | Requirements | Notes for the build |
|---|---|---|---|---|
| 1 | `Main.dc.html` | Users list (المستخدمون) | FR-IAM-01, 03 | Tabs: الكل · نشط · مدعو (incl. «انتهت الدعوة») · معطّل with counts; search by name, e-mail or employee number; filters role, department, branch; row actions; resend invitation inline; banner for expired invitations; empty-filter state |
| 2 | `Invite.dc.html` | Invite a user + choose role | FR-IAM-01, 03, 07 · BR-IAM-1 | Work e-mail (unique per tenant), first + family name (more name parts optional), department, branch, **direct manager picked from a list** (people with a managing role in the chosen department; list follows the department; "managers of all departments" link for cross-department managers — PO feedback 4 Oct 2026), employee number, **one primary role + optional additional roles**, invitation language; 7-day expiry, resend ≤ 3, MFA notice when the role requires it |
| 3 | `UserDetail.dc.html` | User profile | FR-IAM-01, 07, 12, 13 · BR-IAM-3 | Profile fields; roles (primary/additional) with last change; sign-in sessions with "end session" / "end all" (FR-IAM-13); MFA status + reset; failed attempts / lock state; recent audit trail |
| 4 | `Deactivate.dc.html` | Deactivate + reassign | FR-IAM-05 | Explains effects (login blocked, sessions ended, records kept, reactivation possible); items assigned to the user need a new owner (one picker for all or per item type); optional reason → audit log |
| 5 | `Roles.dc.html` | Roles & permissions (الأدوار والصلاحيات) | FR-IAM-07 · BRD Appendix B | **14 tenant roles** (Platform Super Admin is ENTLAQA-only and never shown — shown to and approved by the PO with these screens); read-only matrix per role from Appendix B, sensitive areas flagged; "create custom role" marked «قريبًا» (R2) |
| 6 | `Security.dc.html` | Security settings (الأمان) | FR-IAM-12, 13 | MFA: off / optional / required for all / required for roles, methods, grace period, trusted device; password: min length 12, breached-password check always on, history 5, no forced expiry by default; lockout 5 attempts / 15 min; sessions: inactivity 30 min, max 12 h, max 3 devices. Values are proposed defaults; new organizations still start with MFA off (PO, 1 Oct 2026) |
| 7 | `InviteEmail.dc.html` | Invitation e-mail | FR-IAM-03 · FR-NTF-02 | Arabic first, English below; tenant name/logo; inviter + role; expiry date; no account until accepted. Password-reset e-mail uses the same layout |
| 8 | `AcceptInvite.dc.html` | Accept invitation + set password | FR-IAM-03, 13 | Login e-mail read-only; display name editable; live password rules; privacy-notice acknowledgement; step 2 = MFA setup when required |
| 9 | `InviteStates.dc.html` | Invitation link states | FR-IAM-03 | Expired (request a new one → notifies admins), revoked, already used (sign in / forgot password) |
| 10 | `Forgot.dc.html` | Forgot password | FR-IAM-13 · NFR-SEC-01 | Same answer whether or not the address exists (no account enumeration); link valid 60 min, single use; resend after a short wait |
| 11 | `Reset.dc.html` | Set a new password | FR-IAM-13 · NFR-SEC-01 | Rules incl. breached-password and history checks; other sign-in sessions end after the change; confirmation e-mail |

## Wording decisions

- A signed-in device is a **«جلسة الدخول»**, never «جلسة» alone (that word is a training session) — glossary #145.
- Invitation, deactivate/reactivate and primary/additional role terms: glossary #146–148.
- Copy follows the style guide's gender-neutral rules (no imperatives addressed to the user outside placeholders).
