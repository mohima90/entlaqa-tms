# Business flow — E-mail sending (platform sender + organization Email integration)

| | |
|---|---|
| **Epic** | EP-EMAIL (Super Admin platform sender + Organization Admin Email integration) |
| **Requirements** | FR-ADM-17 (platform settings → e-mail), FR-NTF-02, FR-NTF-11 |
| **Status** | In discussion with the PO (16 Oct 2026) |
| **Copied from** | Kawadir ATS one-to-one: Super Admin **Platform settings → Email**, Org Admin **Settings → Email integration**, sender rule (`sender-rule.ts`, `platform_email_settings`) |

## 1. Goal
Every e-mail of the product (invitations, password reset, password changed, and later training e-mails) is sent by our own notification service, configured **inside the product**, never in GitHub, Vercel or Supabase settings. A new organization can send e-mails from its first minute through the platform sender; an organization that connects its own provider sends everything through it.

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| ENTLAQA operator | Platform Super Admin (not a tenant role) | Sets the platform sender once: provider, key, sender name and address, test send |
| Organization's IT person | Organization Admin | Optionally connects the organization's own provider on the Email integration page |
| L&D Manager | Standard role | Owns the e-mails' texts and look (FR-NTF-10, R2) — not part of this flow |
| Recipients | Any user | Receive the e-mails |

## 3. Step-by-step flow
1. **Super Admin → Platform settings → Email**: chooses the provider (Resend, SMTP, SendGrid, Mailgun, Microsoft 365), pastes the key (write-only: stored encrypted, never shown again), enters sender name and address → **Save and send test** to a chosen address → the sender becomes **verified** only after the test arrives.
2. A new organization is created → its e-mails go out through the **platform sender** (nothing to configure).
3. **Org Admin → Settings → Email integration** (optional): chooses its own provider, key (write-only, encrypted), from name, from address, reply-to → **Send test** → **Enable**. From then on all of the organization's e-mails use it.
4. The Org Admin can switch back to the platform sender at any time.

## 4. Business rules
- **Sender rule (Kawadir):** the organization's own provider when it is configured and enabled → else the platform sender. Platform e-mails (ENTLAQA's own alerts) always use the platform sender.
- **No silent switch:** if an organization's own provider fails, the failure is shown to the Org Admin as theirs to fix (Kawadir rule; replaces "automatic fallback" in FR-NTF-11 — **PO to confirm**, question 1).
- Keys are write-only and encrypted; nobody can read them back, including the Super Admin.
- The platform sender is never used under an organization's name without the organization's brand name as sender name.
- Every change is audited (who, when, what — never the key).
- No e-mail settings in GitHub, Vercel or Supabase: those hold only the database connections the app and worker need to run.

## 5. Decisions and approvals
| Decision | Who decides | When | Result |
|---|---|---|---|
| Platform sender verified | Super Admin (test e-mail arrives) | Once, before the first organization | E-mails can go out |
| Organization uses its own provider | Org Admin | Any time | All its e-mails use it |

## 6. Exceptions
- **No platform sender yet:** e-mails wait in the queue (nothing lost) and the Super Admin sees a warning; they go out once the sender is verified.
- **Organization provider fails** (wrong key, domain not verified): delivery error shown on the Email integration page; the Org Admin fixes or switches back.
- **Key expired / revoked:** same as above; for the platform sender the Super Admin is alerted.

## 7. Inputs and outputs
| Input | Output |
|---|---|
| Provider key, sender name/address (typed in the product) | Encrypted settings in the database |
| E-mails queued by the product | Delivered e-mails + delivery status per message |

## 8. Screens this implies
| # | Screen | Role | Main actions |
|---|---|---|---|
| 1 | Platform settings → Email (Kawadir layout) | Super Admin | Provider, key, sender, save and test, status |
| 2 | Settings → Email integration (Kawadir layout) | Org Admin | Platform sender (default) or own provider, test, enable, delivery errors |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| 1 | If the organization's own provider fails, fall back to the platform sender automatically? | **No** (Kawadir rule): show the error to the Org Admin | |
| 2 | Who is the first Super Admin? | You (the PO), created once by a workflow Claude runs | |
| 3 | Providers in R1 | Resend, SMTP, SendGrid, Mailgun, Microsoft 365 (as Kawadir) | |
