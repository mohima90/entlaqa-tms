# Business flow — Sign-in extras (codes by e-mail, remember this device)

| | |
|---|---|
| **Work package** | WP-ADM-05 (ROADMAP-by-role) · BACKLOG T-M2-52 (this flow), T-M2-28 (build) · addendum to EP-KAW-AUTH |
| **Requirements** | FR-IAM-12 (MFA: authenticator app **and e-mail code**, no SMS; off / optional / required for all / for selected roles; grace period; **trusted-device duration**) · FR-IAM-13 (lockout, sessions) · FR-NTF-11 / EP-EMAIL (who sends the e-mails) · FR-AUD-01 |
| **Status** | ****Agreed (PO, 21 Oct 2026)** — with the PO answers below** (21 Oct 2026) |
| **Copied from Kawadir** | Kawadir ATS sign-in: e-mail first, then **password** or **«Email me a code instead»** — a 6-digit code that **replaces the password**, valid 10 minutes, 5 wrong tries per code, a new code at most once a minute, the same answer whether or not the address has an account, always sent by **Kawadir's own platform sender** in the organization's look; the browser remembers the method used last. Kawadir has **no second factor** (its «Require 2FA for admins» switch says «not enforced yet») and **no trusted devices**. **We copy:** the code rules (6 digits, 10 minutes, 5 tries, 1 minute between codes, same answer), the platform sender in the organization's look, remembering the last method. **We do not copy:** a code *instead of* the password (question 1) |

## 1. Goal
People who do not want an authenticator app can still use a second step at sign-in: a code sent to their work e-mail. And on their own computer or phone they can tick «Remember this browser» so the code is not asked every day — for as long as their organization allows. The two «Coming soon» items on the Security page become real.

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| Organization's IT person | Organization Admin | On **Settings → Security** allows e-mail codes and sets how long a browser may be remembered |
| Any member | Any | Signs in with password + app code or e-mail code; may tick «Remember this browser»; forgets remembered browsers on My profile |
| ENTLAQA operator | Platform Super Admin | Keeps the platform sender working (EP-EMAIL) — sign-in codes depend on it |

**What exists today** (from the code): authenticator app with an e-mailed confirmation at set-up; modes off / optional / required for everyone / for selected roles; grace 0–30 days; Organization Admins invited to set up an app; lockout after 3–5 wrong passwords for 15–60 minutes; 5 wrong codes in 15 minutes pause code checks and e-mail the owner; «Remember this browser» on the sign-in page (unticked by default, 30 days) — today it only lets that browser keep signing in during a lockout; the Organization Admin can unlock a member and reset a lost authenticator.

## 3. Step-by-step flow
1. **Organization Admin → Settings → Security → Multi-factor authentication** → *Allowed methods*: Authenticator app (always) + **Code by e-mail** (switch) → *Remember a trusted device*: **Off / 1 / 7 / 14 / 30 days** → Save → every Organization Admin is e-mailed the change (as today).
2. **Member signs in:** e-mail → password → if their organization asks for a second step:
   - has an authenticator app → enters the app code;
   - no app and e-mail codes allowed → «We sent a 6-digit code to m•••@company.com» → types it (valid 10 minutes; **Send a new code** after 1 minute).
3. On that screen the member may tick **«Remember this browser»** → no second step on this browser for the organization's period; the same tick keeps today's lockout protection.
4. **MFA required:** a member without an app meets the requirement with e-mail codes from their first sign-in; the grace period only matters where e-mail codes are not allowed. Organization Admins keep the invitation to set up an app.
5. **My profile → Sign-in security** lists the member's methods and «N remembered browsers — **Forget all**».
6. **Organization Admin → member profile → End sessions** also forgets that member's remembered browsers.

## 4. Business rules
- BR-AUTH-a **Second step, not a replacement:** the e-mail code always comes **after** the password (FR-IAM-12); a mailbox alone never opens an account.
- BR-AUTH-b **The code:** 6 digits, valid 10 minutes, single use, 5 wrong tries kill it, a new code at most once a minute; wrong e-mail codes and wrong app codes share today's limit (5 in 15 minutes → code checks paused and the owner e-mailed «someone knows your password»). The answer never tells whether an address has an account.
- BR-AUTH-c **App first:** a member with an authenticator app uses the app; e-mail codes are for members without one (question 3).
- BR-AUTH-d **Only at sign-in:** organization-level actions need no extra code (PO, 14 Oct 2026, «not a banking system»), so the e-mail code matters only at sign-in; removing one's own authenticator app keeps its current checks.
- BR-AUTH-e **Who sends the code:** always the **platform sender** (Kawadir rule), in the organization's look — so an organization's broken own mail provider never locks its people out. The Organization Admin can switch e-mail codes on only while e-mails are actually going out.
- BR-AUTH-f **Remembered browser:** only after the second step passed on that browser; the period is the organization's setting (default **Off** = today's behaviour); shortening or switching it off applies at once to existing remembered browsers; at most 10 per person (as today).
- BR-AUTH-g **A remembered browser is forgotten when:** the password is changed or reset, an authenticator is removed or reset, the member uses «Forget all», the Organization Admin ends the member's sessions, the member is deactivated.
- BR-AUTH-h **Several organizations:** a person follows the strictest of their organizations — the code is asked if any requires it, and the shortest remembered period applies (as for passwords, security decision 5).
- BR-AUTH-i **Audit:** code sent (never the code), code accepted / refused, browser remembered, browsers forgotten, setting changes with before → after (EP-AUD).
- BR-AUTH-j **Security page clean-up:** «Code by text message» is removed (no SMS anywhere — PO, 14 Oct 2026); nothing stays marked «Coming soon» without a plan (question 6).

## 5. Decisions and approvals
| Decision / approval | Who decides | When | What happens |
|---|---|---|---|
| Allow e-mail codes; remembered-browser period | Organization Admin | Any time | Applies at members' next sign-in; Organization Admins e-mailed |
| Remember this browser | The member, per browser | At sign-in | No second step there for the period |

## 6. Exceptions
- **Code does not arrive** (spam folder, sending delayed) → «Send a new code» after 1 minute; a member with an app uses it; nobody can skip the step for them.
- **Platform sender down** → members who depend on e-mail codes cannot finish signing in; the Super Admin is warned (EP-EMAIL); the Security page shows the problem to the Organization Admin.
- **Too many wrong codes** → code checks paused 15 minutes, owner e-mailed (as today).
- **Code expired or already used** → «Ask for a new code».
- **Lost phone with the app** → as today: the Organization Admin resets the authenticator; until the member sets up a new app they get e-mail codes if allowed.
- **Shared computer ticked by mistake** → the member uses «Forget all» or changes the password.

## 7. Inputs and outputs
| Input (from where) | Output (to where) |
|---|---|
| Security settings (Organization Admin) | Allowed methods, remembered period |
| Password + code (member) | Signed-in session; optionally a remembered browser |
| — | Code e-mails (platform sender), security notices, audit events |

## 8. Screens this implies
| # | Screen | Role | Main actions |
|---|---|---|---|
| 1 | Settings → Security: «Code by e-mail» switch, «Remember a trusted device» choice (the two «Coming soon» rows) | Organization Admin | Allow, choose period, save |
| 2 | Sign-in → «Enter the code we e-mailed you» (resend, remember this browser) | Any member | Type code, resend, tick |
| 3 | My profile → Sign-in security (methods, remembered browsers, Forget all) | Any member | Forget all |
| 4 | Code e-mail (Arabic and English, organization's look) | Any member | — |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| 1 | Kawadir's **«Email me a code instead»** of the password — copy it? | **No** for R1: a mailbox alone would open the account; the e-mail code is a second step after the password (FR-IAM-12) | |
| 2 | Code rules as Kawadir (6 digits, 10 minutes, 5 tries, 1 minute between codes)? | **Yes** | |
| 3 | Can a member with an authenticator app choose an e-mail code instead? | **No** — the weaker method must not undo the stronger one; lost phone → reset by the Organization Admin | |
| 4 | Sign-in codes always through the **platform sender** (Kawadir), even when the organization has its own provider? | **Yes** | |
| 5 | Remembered-browser periods and default | **Off / 1 / 7 / 14 / 30 days**, default **Off** (no change for organizations until they choose) | |
| 6 | Security page: remove «Code by text message» and «Block reuse of earlier passwords» (not in R1)? | **Yes**, remove both | |
| 7 | When MFA is required for selected roles (e.g. the Organization Admin), does an e-mail code satisfy it for those roles too? | **Yes** — same rule for everyone; an organization wanting more asks those roles to set up an app | |
| 8 | Codes must arrive within about a minute; today e-mails go out through background runs that can take a few minutes. Accept a dedicated fast path or the always-on worker host (cost, already on the list before the first customer)? | **Yes** — needed before e-mail codes are switched on in production | |


## PO answers (21 Oct 2026)
| # | PO answer |
|---|---|
| 1 | **Yes — the e-mail code can replace the password** for people whose role does **not** require MFA (e-mail + code, as in Kawadir). **Roles with MFA required** sign in with password + e-mail code, or with the authenticator app — confirmed |
| 2 | Approved — 6 digits, 10 minutes, 5 tries, one new code a minute |
| 3 | Approved — someone with an authenticator app cannot use an e-mail code instead |
| 4 | **No — codes go through the organization's own e-mail sender when it is set up, otherwise the platform sender** (the WP-ADM-01 sender rule) |
| 5 | Approved — remember this device: Off / 1 / 7 / 14 / 30 days, default Off |
| 6 | **No — keep «Code by text message» and «Block reuse of earlier passwords» on the Security page** («Coming soon») |
| 7 | Approved — an e-mail code is the second step after the password for roles with MFA required (never both factors at once) — confirmed |
| 8 | Approved — e-mail codes stay off in production until delivery is fast |
