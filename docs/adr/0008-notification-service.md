# ADR 0008 — Notification service abstraction

**Status:** Accepted — PR #9, 30 Sep 2026 · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B08 · **Related:** BRD §6.20 (FR-NTF-01…09, BR-NTF-1/2), Appendix D, FR-LRN-03/07, FR-AUD-05, FR-ENR-06, FR-SUB-01, NFR-L10N-11, NFR-PERF-06, §15; Development Plan §6.6 security focus; decision D5; ADR 0003, ADR 0004, ADR 0005, ADR 0007, ADR 0009, ADR 0010

## Context

- Notifications are a shared platform service (BRD §3.4.1) used by every suite module; the suite shell has one notification inbox (FR-STE-08).
- R1 channels: **in-app** (real-time, FR-NTF-01) and **e-mail** (branded bilingual templates, custom sending domain, FR-NTF-02), with an event catalog, per-event rules and **quiet hours respecting prayer times and weekends** (FR-NTF-07), scheduled reminders and digests (FR-NTF-08), channel/language preferences (FR-LRN-07) and .ics invitations (FR-LRN-03). R2: WhatsApp (FR-NTF-03), SMS (FR-NTF-04), web push (FR-NTF-05), broadcasts (FR-NTF-09). R3: Teams/Slack (FR-NTF-06).
- Every outbound message must be logged with status for 12 months (BR-NTF-2); fallback order must be configurable (BR-NTF-1).
- Vendors differ by deployment: international providers for regional SaaS; in-country gateways/relays for sovereign tenants (BRD §15, D5 open until R2).

## Options considered

1. **Call providers directly from features** — fast, but every module re-implements templates, preferences, consent, quiet hours and logging.
2. **Third-party notification platform** (e.g., hosted orchestration SaaS) — rich features, but data leaves the jurisdiction and it is not self-hostable in-country.
3. **Own platform service** (`platform-notifications`): event-driven pipeline on ADR 0004/0005 with a channel/provider adapter interface — chosen.

## Decision

### 1. Pipeline
```
domain event (outbox) ─► notifications subscriber ─► rule resolution ─► recipients ─► per-recipient planning
   ─► platform.notifications (logical message) ─► platform.message_deliveries (one per channel attempt)
   ─► send job (provider adapter) ─► provider status webhooks ─► delivery status updates
```
1. **Event catalog** (code registry per module, mirrors BRD Appendix D): key (`tms.session.reminder`, `tms.enrollment.approved`, `platform.user.invited`, …), triggering event types, recipient resolvers (learner, manager, instructor, coordinator, role in scope), variables schema (zod, from `packages/contracts`), default channels and timing, **category** (`security` · `transactional` · `reminder` · `digest` · `broadcast`) and `time_sensitive` flag.
2. **Tenant rules** (`platform.notification_rules`): enable/disable per event, channels, recipient roles, timing offsets (e.g., reminders T-7d/T-3d/T-1d/T-1h), digest inclusion. Security events (invitation, password reset, MFA, sign-in alerts) cannot be disabled or deferred.
3. **Per recipient planning:** locale (recipient preference → tenant default, NFR-L10N-11), channel preferences (FR-LRN-07, within what the tenant allows), **consent** (WhatsApp opt-in, FR-AUD-05), channel availability (verified e-mail/mobile), quiet hours (§4), rate limits (§6) → ordered channel plan with fallback (§5).
4. Handlers never call providers inside the event transaction; they write `notifications` + `message_deliveries` rows, and send jobs (ADR 0005) call the adapter with the delivery id as idempotency key.

### 2. Channels and adapters
```ts
interface ChannelAdapter {
  channel: 'in_app' | 'email' | 'sms' | 'whatsapp' | 'push' | 'teams';
  provider: string;                               // 'smtp', 'ses', 'resend', 'unifonic', 'meta_cloud', …
  send(msg: RenderedMessage, ctx: SendContext): Promise<{ providerMessageId: string }>;
  parseStatusWebhook?(req: Request): Promise<DeliveryStatusUpdate[]>; // signature verified inside
  capabilities: { maxLength?: number; interactive?: boolean; attachments?: boolean };
}
```
| Channel | Release | Regional SaaS (default candidates) | In-country / sovereign alternative |
|---|---|---|---|
| In-app | R1 | `platform.inbox_items` + Supabase Realtime (private channel per user, RLS-authorized) | Same (self-hosted Realtime) |
| E-mail | R1 | Transactional API provider with an EU region (e.g., Amazon SES `eu-central-1` or Resend — verify region/data terms) | **SMTP adapter** to an in-country relay (customer Exchange/Postfix or local provider); SES has a UAE region (`me-central-1`) — verify for KSA |
| SMS | R2 | MENA gateway (e.g., Unifonic, Taqnyat, Msegat) + international fallback (e.g., Twilio/Infobip) | In-country gateway with registered sender IDs (KSA sender-ID registration rules apply) |
| WhatsApp | R2 | Meta WhatsApp Cloud API or an approved BSP (D5) | No in-country option: messages transit Meta; disabled by default for sovereign tenants unless the customer accepts it |
| Web push | R2 | VAPID Web Push (self-hosted keys; payloads encrypted end-to-end) | Push services are operated by browser vendors outside the country → content-free "you have a new notification" payloads for sovereign tenants |
| Teams/Slack | R3 | Bot/app per tenant | Customer's M365 tenant |

Provider credentials are per platform (default) or per tenant (own sender), stored encrypted (ADR 0010 secrets). Adapter choice per deployment is configuration; code is identical (BRD §15).

### 3. Templates
- **System templates** (global, versioned in the repo, seeded to `platform.ref_notification_templates`) per event × channel × locale (`ar`, `en`); **tenant overrides** in `platform.notification_templates` (FR-NTF-02); every template exists in both languages (NFR-L10N-11).
- Tenant-editable text uses **LiquidJS** in strict, sandboxed mode (no JS execution; unknown variables and filters are errors; HTML output escaped by default) with whitelisted variables from the event's schema and i18n filters (`date` with Gregorian/Hijri/dual per ADR 0007, `number` with tenant numerals, `money`).
- E-mail layout is a branded React Email component (logo/colors from ADM-07, `dir`/`lang` set, plain-text alternative); preview with sample data (FR-NTF-02). SMS rendering counts segments (UCS-2 for Arabic: 70 chars, 67 per concatenated part); WhatsApp uses Meta-approved templates mapped to our variables, with approval status tracked (R2).
- Content rule (Plan §6.6): no sensitive data in e-mail/SMS/push previews — messages carry a summary and a deep link that requires sign-in; approval links are **signed, single-use, expiring action tokens** (`platform.action_tokens`, hashed) bound to recipient and action.

### 4. Quiet hours
- Evaluated in the recipient's timezone and branch working calendar (ADR 0007): tenant-defined night window (default 22:00–07:00), non-working days, **prayer windows** (computed locally from the recipient's branch/venue location, ADR 0007 §8) and Jumu'ah block.
- Non-urgent messages falling in a quiet window are **deferred** to the window's end (`scheduled_for`). `time_sensitive` events (e.g., session cancelled today, T-1h reminder) bypass weekend/prayer deferral but not the night window unless the tenant allows; `security` events are never deferred. In-app inbox items are always created immediately (only the push/e-mail/SMS side is deferred).

### 5. Fallback order
Configurable per tenant and event (BR-NTF-1), default for R2+: WhatsApp → SMS → e-mail; R1: e-mail (+ in-app always). Fallback triggers: no consent/opt-in, missing address, provider hard failure, or no `delivered` status within a channel timeout. Each attempt is its own `message_deliveries` row.

### 6. Rate limits and volume control
- Provider limits: token bucket per provider account (configured per provider).
- Tenant limits: edition quotas (e.g., WhatsApp/SMS messages per month, SUB-01) checked before sending; over-quota behavior per edition (block/notify).
- Recipient protection: collapse keys and a per-recipient cap for non-critical categories (excess goes to the next digest).

### 7. Delivery log and status
- `platform.message_deliveries`: tenant, notification, channel, provider, provider_message_id, masked destination + keyed hash (for support lookups without storing plain addresses in the log), status `queued → sent → delivered → read | failed | suppressed | deferred`, timestamps per status, attempts, sanitized error code. Retained 12 months (BR-NTF-2), then purged by housekeeping. Rendered message bodies are not kept beyond 30 days (only template id/version + variables hash).
- Provider status webhooks (`/api/hooks/notifications/<provider>`) follow the inbound pattern of ADR 0011 §7: the web tier (which holds no provider secrets, ADR 0005 §1) only rate-limits and stores the raw request; the worker verifies the provider signature and updates statuses idempotently.
- Metrics and alerts on failure rate per channel/provider (ADR 0009).

### 8. In-app and real-time
Inbox items are written by the send job; the job then emits a Realtime broadcast on the private topic `tenant:<tenant_id>:person:<person_id>` carrying only an id/counter. The browser subscribes with the short-lived, **in-memory** Realtime token handed out by the server (ADR 0003 §4.4 — the browser never uses Supabase for authentication) and refetches the inbox through server code (the browser does not query tables). Topic authorization is enforced by RLS on Realtime messages (verify self-hosted parity, ADR 0010 §3a); if Realtime is unavailable the bell falls back to periodic server polling. Target ≤ 2 s from event commit (NFR-PERF-06) in daemon mode (ADR 0005).

### 9. WhatsApp consent (R2, schema in R1)
Opt-in captured per person and purpose in `platform.consent_records` (FR-AUD-05) with timestamp, channel and evidence; opt-out keywords and Meta opt-out webhooks withdraw consent immediately; no template is sent without active consent; interactive replies (approve/reject, FR-ENR-06) are authenticated through action tokens bound to the recipient and action, processed by the worker (system claims, acting on behalf of the bound person — recorded as such in the audit log) and audited. In R1, e-mail approval links open the app and require sign-in.

### 10. Calendar invitations
.ics attachments (RFC 5545 `METHOD:REQUEST`/`CANCEL`) with stable `UID` per enrollment+session and incrementing `SEQUENCE` on changes (FR-LRN-03, FR-SCH-14 R2 adds two-way sync); a personal tokenized ICS feed URL per person (revocable).

## Consequences

**Positive:** one pipeline for all modules and channels; bilingual templates and quiet hours applied uniformly; vendor-neutral with in-country options; full delivery evidence.

**Negative / costs:** significant platform work in M2 (catalog, rules, templates, preferences, log); provider onboarding per region (sender domains, sender IDs, WhatsApp templates) is operational work; deferred delivery requires clear UX ("scheduled for 07:00").

## Security impact
No sensitive data in message previews; signed single-use action tokens; provider webhooks signature-verified; addresses masked in logs; Liquid sandbox prevents template injection; tenant-scoped RLS on all notification tables; consent enforced before WhatsApp.

## Sovereign deployment impact
In-app and SMTP e-mail work fully in-country; SMS via local gateways; WhatsApp and web push inherently involve foreign operators and are opt-in per tenant with explicit disclosure.

## Suite impact
Other modules register their events in the catalog (namespaced keys) and reuse templates, preferences, the inbox and the delivery log.

## Verification
1. Unit tests: rule resolution, locale fallback, quiet-hour deferral incl. prayer windows and Friday, fallback ordering, SMS segment counting.
2. Integration tests with provider fakes (Mailpit for SMTP in CI and the self-hosted stack): idempotent sends under retry; status webhook signature failures rejected.
3. E2E (J5): enrollment approval → e-mail with .ics + in-app item in ≤ 2 s; Arabic and English templates.
4. Template lint: every system template exists in `ar` and `en`, compiles in strict Liquid, uses only declared variables.

## Implementation notes

### T-M2-06b (6 Oct 2026): e-mail channel, delivery log, first template
- **Pipeline slice:** `queueEmail(tx, …)` (in a notification subscriber's tenant transaction) renders the template and writes `platform.message_deliveries` plus the event `com.entlaqa.platform.email.queued`; the sender is an *effect* subscriber (ADR 0004 implementation notes) that claims the delivery, calls the provider with the delivery id as idempotency key and records the outcome. `platform.notifications` (the logical message), rules, preferences, quiet hours and the in-app inbox arrive with the first features that need them.
- **Providers:** Resend over its HTTP API (regional cloud, PO decision 6 Oct 2026; `Idempotency-Key` honoured for 24 hours) and SMTP via nodemailer (sovereign relays; Mailpit stands in for the relay in the self-hosted stack and CI smoke, with STARTTLS required and verified). Provider credentials live only in the worker's environment — on staging the GitHub environment `staging-jobs`, not Vercel. Errors are reduced to our own codes; provider texts (which may quote addresses) are never kept.
- **Templates (deviation from §3):** system templates are typed TypeScript functions over escaped markup (no React Email, no LiquidJS yet: tenant overrides come with the notification settings screen). Variables are validated with zod; links must be https. **Both languages in one message** — the approved invitation e-mail (screen 7) puts the primary language first and the other below, because the recipient's own preference is not known yet; the content style guide's one-language rule applies to later notifications.
- **Delivery log (deviation from §7):** content and the plain address are removed as soon as a delivery is final (not after 30 days); the masked address stays, the keyed hash is not built yet. A suspended or closed organization's waiting messages are discarded by their send job (suppressed, `TENANT_INACTIVE`) through the SECURITY DEFINER function `private.discard_inactive_tenant_delivery` (owner `tenant_guard`; one waiting row of the job's own inactive tenant). If the last attempt fails on the database itself, the sender still tries to record `failed`; a delivery that stays waiting even so keeps its content until a sweeper removes it (more than 24 hours waiting → `failed`, `STALE`) — a follow-up built with the delivery-log retention housekeeping before production (BACKLOG T-M2-06). The table is jobs-only (system claims) with a lifecycle trigger (queued ⇄ sending → sent | failed | suppressed; what is sent and to whom never changes). No provider status webhooks yet (delivered/bounced are visible in the Resend dashboard). Retries: 10 attempts over about 3.5 hours; Resend rate limits are waited out in place (Retry-After, capped at 10 s, twice) so a burst does not use up attempts.

### T-M2-08 (7 Oct 2026): authentication e-mails go through Supabase Auth's own mailer (deviation)
- **What:** the password-reset e-mail and the "password changed" notice are sent by **Supabase Auth itself** through the project's SMTP (Resend on hosted, the installation's relay self-hosted — Mailpit in the stack), with our bilingual templates (`supabase/templates/recovery.html`, `password-changed.html`; layout of the approved invitation e-mail). They do **not** pass through `queueEmail`, `platform.message_deliveries` or the worker. Runbook: `docs/engineering/password-reset.md`.
- **Why (deviation from §1, §3, §7):** the reset token is created and stored by Auth (single use, 60 minutes, rate limited per account) and only Auth can e-mail it without the web app holding the Auth secret key (ADR 0002 §7: none in the web app; the alternative — the admin `generateLink` API from a job — would put that key in the worker for an unauthenticated, internet-triggered flow). The e-mails are account-level, not tenant-level: there is no tenant to log the delivery under, no tenant rules or quiet hours apply (security category: never deferred, §1.2/§4), and the content holds no personal data beyond the recipient's address.
- **Consequences:** no row in the delivery log (BR-NTF-2) for these two messages — evidence is Auth's own logs (hosted: Logs Explorer; self-hosted: the Auth container) and the provider dashboard; templates are maintained as Go `html/template` files (escaped by Auth) beside the TypeScript ones, guarded by `scripts/auth-templates.test.mjs` (link to our page with the token hash in the URL fragment only, no one-time code, no `/verify` link, Arabic first); hosted templates are pasted into the dashboard (no deploy pipeline yet) and self-hosted ones are served to GoTrue by a small internal container (`auth-templates`). If a template cannot be loaded GoTrue silently falls back to its English default (`template_body_http_error`) — alerting on it is a follow-up. Revisit when Auth's Send Email Hook can hand these messages to our pipeline without weakening the no-secret-key rule.
