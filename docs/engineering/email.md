# E-mail (runbook)

| | |
|---|---|
| **Backlog** | T-M2-06 part b (e-mail delivery); used by T-M2-07 (invitations), T-M2-08 (password reset) |
| **Architecture** | ADR 0008 (notification service), ADR 0004/0005 (events and jobs) — runbook [background-jobs.md](background-jobs.md) |
| **Code** | `packages/platform-notifications` (templates, `queueEmail`, sender, Resend/SMTP transports) · `platform.message_deliveries` (migration `20261008090000`) · `apps/worker` |
| **Provider** | Regional cloud: **Resend** (PO, 6 Oct 2026), sending domain `lms.entlaqa.com`, sender «ENTLAQA LMS» <noreply@lms.entlaqa.com>. Sovereign: SMTP to the installation's relay |

## 1. How a message travels

1. A notification subscriber (a job, system claims) calls `queueEmail(tx, { template, locale, to, variables })` in its tenant transaction. The template is rendered in **both languages** — the primary one first with the action button, the other below with a plain link (approved invitation e-mail, screen 7) — and stored in `platform.message_deliveries` with the address, plus an event `com.entlaqa.platform.email.queued`.
2. The worker's e-mail sender (`notifications.email`, an *effect* subscriber) claims the delivery, sends it with the **delivery id as idempotency key** (Resend returns the first result for a repeated request within 24 hours; over SMTP it becomes the `Message-ID`), and records the outcome.
3. Once a delivery is final — `sent`, `failed` or `suppressed` — its content and plain address are removed; the log keeps the template, language, masked address (`n***@example.com`), provider and its message id, status, attempts and error code (12 months, housekeeping later).
4. A temporary failure (provider down, network) puts the delivery back to `queued` and the job retries with back-off for about **3.5 hours** (10 attempts); a refusal that a retry cannot fix (invalid address, rejected message) or the last attempt records `failed`. Resend rate limits are waited out in place first (Retry-After, at most 10 s, twice). A wrong or revoked API key, or a sender outside the verified domain, counts as temporary, so fixing it within that time lets the waiting messages go out (a missing key stops the worker at start-up with a configuration error).
5. With e-mail switched off (`EMAIL_PROVIDER=none`), deliveries are recorded as `suppressed` (`EMAIL_DISABLED`) instead of piling up. The variable has no default: a worker without it does not start.
6. A suspended or closed organization's waiting messages are not sent: their send job discards them (`suppressed`, `TENANT_INACTIVE`, content removed). If the sender's last attempt fails on the database itself it still tries to record `failed` (`DELIVERY_ERROR`); a message left waiting even then keeps its content until the stale-delivery sweeper (planned with retention housekeeping, before production) removes it.

Only jobs (system claims) can read or write deliveries, and the sender acts only on events written by a job; logs and the queue carry codes, never addresses or content.

## 2. Settings (worker only — the web app never holds provider credentials)

| Variable | Meaning |
|---|---|
| `EMAIL_PROVIDER` | `resend`, `smtp` or `none` (switched off); required, no default (the staging workflow passes `none` until the variable is set) |
| `EMAIL_FROM_NAME` / `EMAIL_FROM_ADDRESS` | Sender shown to recipients; the address must be on a domain verified with the provider |
| `RESEND_API_KEY` | Resend API key (`re_…`); give it **sending access only** |
| `SMTP_URL` | `smtp://user:password@relay:587` (STARTTLS, required for any non-local server) or `smtps://…:465`; no parameters |
| `SMTP_CA_CERT_FILE` / `SMTP_CA_CERT` | CA of a relay whose certificate is not publicly trusted (empty: the system's public roots) |
| `EMAIL_TEST_TO` | Recipient of the `test-email` mode |

Check any deployment's settings with `node apps/worker/dist/main.mjs test-email` (one sample invitation, marked `[TEST]`, straight to the provider; no database). The self-hosted stack sends one to Mailpit in its smoke test. This checks the provider settings only; the whole path (queue → dispatch → send) runs on staging with the first real sender, the invitations of T-M2-07.

**Self-hosted with a real relay:** set `SMTP_URL` (and `SMTP_CA_CERT_FILE`, or set it empty for a publicly trusted certificate), remove the `mailpit` service, the worker's `depends_on: mailpit` entry and its `mail-ca.crt` mount, and give the worker a network that reaches the relay (the stack's `mail` network is internal) — see the comment in `infra/docker/compose.yaml`.

## 3. Staging set-up (Product Owner, once, after the PR is merged — Claude guides one step at a time)

All in GitHub → Settings → Environments → **staging-jobs** (where the worker runs; never in Vercel):
1. **Secret** `RESEND_API_KEY` = a Resend API key with **Sending access** for the domain `lms.entlaqa.com` (Resend → API Keys → Create).
2. **Variables** `EMAIL_PROVIDER` = `resend`, `EMAIL_FROM_NAME` = `ENTLAQA LMS`, `EMAIL_FROM_ADDRESS` = `noreply@lms.entlaqa.com`.
3. **Secret** `EMAIL_TEST_TO` = the PO's own e-mail address.
4. DB deploy (plan, then apply) for the delivery-log table.
5. Actions → **Jobs (staging)** → Run workflow → mode **test-email**: the sample invitation must arrive (check spam once); the run log shows `test e-mail accepted by resend (<id>)`.

## 4. Operations

| Situation | What to do |
|---|---|
| A message did not arrive | As the database owner (SQL editor): `select status, error_code, attempts, provider_message_id, created_at from platform.message_deliveries where destination_masked like 'x***@%' order by created_at desc` — then look up `provider_message_id` in the Resend dashboard (bounces, spam complaints) |
| Many `PROVIDER_AUTH` codes | The API key is wrong, revoked or lacks sending access, or the sending domain is not verified / `EMAIL_FROM_ADDRESS` is not on it (Resend → Domains): fix it; waiting messages go out on their next attempt (within about 3.5 hours) |
| `INVALID_IDEMPOTENT_REQUEST` | The same delivery was sent before with different content (the sender settings changed between attempts): it may have arrived — check `provider_message_id`-less rows against the Resend dashboard before re-sending |
| `TENANT_INACTIVE` | The organization was suspended or closed before the message went out; nothing to do (not replayed) |
| `DELIVERY_ERROR` | The last attempt failed on the database, not at the provider — the message may still have gone out: check the Resend dashboard (or the relay's log) and the worker logs at that time before triggering it again |
| `VALIDATION_ERROR` / `ADDRESS_REJECTED` | The address or message was refused for good; correct the person's e-mail and trigger the message again (e.g. resend the invitation) |
| Deliverability | SPF, DKIM and DMARC records of the sending domain are set in Resend → Domains; a dedicated TMS sending subdomain is planned before real customers (PO follow-up) |

Not built yet (ADR 0008): in-app inbox, notification rules and preferences, quiet hours, tenant-edited templates (LiquidJS), provider status webhooks (delivered/bounced), keyed hashes of addresses, retention housekeeping, alerts on failure rates.
