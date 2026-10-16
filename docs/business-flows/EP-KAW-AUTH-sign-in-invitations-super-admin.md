# Business flow — Sign-in, invitations and Super Admin (Kawadir way)

| | |
|---|---|
| **Epic** | EP-KAW-AUTH (BACKLOG T-M2-44, T-M2-45) |
| **Requirements** | FR-IAM-03 (invitations), FR-IAM-12/13 (sign-in), FR-ADM-17 (platform console) |
| **Status** | **Agreed (PO, 16 Oct 2026)** — "implement what is in Kawadir in sign in and invitation exactly, no need for proposal"; "no need to send an e-mail, a link like Kawadir"; the PO's account takes the Super Admin role and is added manually; a test organization `entlaqa` is created with a new user as its Organization Admin |
| **Copied from** | Kawadir ATS: `/login` (e-mail first, then method), `/signup?code=` (join with code), Team → pending invites (code + copy link, resend, cancel), Super Admin → Organizations (create organization with admin e-mail, link shown to copy) |
| **Design records** | `docs/engineering/invitations-contract.md` §0 · `docs/engineering/platform-console.md` · ADR 0013 |

## 1. Goal
People get into the product without any e-mail being sent: the person who invites copies a link or code and shares it however they like. ENTLAQA's Super Admin creates organizations and hands each one to its Organization Admin the same way.

## 2. Actors and roles
| Actor | Role | What they do |
|---|---|---|
| ENTLAQA operator | Platform Super Admin («مشرف المنصة», not a tenant role) | Creates organizations; copies the Organization Admin's invitation link or code |
| Organization's IT person | Organization Admin | Invites team members (and HR Manager can invite ordinary roles); copies link/code; resends, cancels |
| Invited person | Any role | Opens the link (or types the code), sets a password, is signed in |
| Claude (tech lead) | — | Grants or revokes Super Admin by user ID through the Platform admin workflow |

## 3. Step-by-step flow
1. **Super Admin account (once):** the PO adds their own user in Supabase → Authentication → Users (runbook `platform-console.md`); Claude runs the **Platform admin** workflow with that user's ID → the account is Super Admin.
2. **Sign in (everyone):** e-mail first → password (an e-mailed sign-in code comes later with the platform sender). A Super Admin without an organization lands on **Platform → Organizations**.
3. **Create organization (Super Admin):** short name, names (Arabic, English), Organization Admin e-mail and name, language → the screen shows the **invitation code and link, each with Copy**.
4. **Organization Admin joins:** opens the link (or types the code on «Have an invitation code?») → organization and e-mail shown, e-mail locked → chooses a password → signed in to the organization.
5. **Invite team members (Organization Admin / HR Manager):** fill the invite form → success panel with **Copy code / Copy invite link**; **Team members → Pending invites** keeps Copy, **Resend** (new code, old one stops) and **Cancel**. If e-mail sending is set up, the link is also e-mailed; it is never required.
6. **Existing account:** someone who already has an account signs in and accepts with the code.

## 4. Business rules
- A code is bound to one e-mail and one organization, single use, valid 7 days, at most 4 codes per invitation; a new code replaces the old.
- Codes are 12 characters, shown `XXXX-XXXX-XXXX` (Kawadir uses 8; longer for security — review H1). Wrong codes are limited per visitor and platform-wide.
- Only the Organization Admin may invite with, or copy the code of, a privileged role (Organization Admin, Auditor, …); HR Manager handles ordinary roles.
- A Super Admin's console invitation gives only the Organization Admin role and stops working if that Super Admin is revoked (a new code is issued by another Super Admin).
- Copying a code is recorded in the audit log (never the code itself).
- No sender settings in GitHub, Vercel or Supabase; e-mail sending is a separate flow (`EP-EMAIL`).

## 5. Decisions and approvals
| Decision | Who | Result |
|---|---|---|
| Grant / revoke Super Admin | Claude via workflow, on the PO's request | Account can / cannot open the console |
| MFA for the Super Admin (FR-ADM-17) | PO — **open** | Not enforced now (risk R-65) |

## 6. Exceptions
- Code expired, cancelled, already used, or unknown → the sign-up page says so; the inviter resends.
- The invited e-mail already has an account → "sign in to accept".
- The Super Admin who created an organization is revoked → its Organization Admin invitation shows "Needs a new code".
- Too many wrong codes → the visitor waits 15 minutes.

## 7. Inputs and outputs
| Input | Output |
|---|---|
| Organization data + Organization Admin e-mail (Super Admin) | Organization + invitation code/link |
| Person details + roles (Organization Admin / HR) | Invitation code/link |
| Code + password (invited person) | Active membership, signed in |

## 8. Screens
| # | Screen | Role |
|---|---|---|
| 1 | Sign in (e-mail → password) | Everyone |
| 2 | Join with code (`/sign-up`) | Invited person |
| 3 | Forgot / reset password | Everyone |
| 4 | Team members → Pending invites; invite success panel | Organization Admin, HR Manager |
| 5 | Platform → Organizations; Create organization; code/link dialog | Super Admin |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| 1 | MFA for the Super Admin before the first customer? | Yes, authenticator app for the Super Admin only | |
| 2 | Turn on «Confirm email» once the platform sender exists? | Yes (risk R-66) | |
