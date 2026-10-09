# Sign-in protection (runbook)

| | |
|---|---|
| **Backlog** | T-M2-11 (carry-over from T-M1-D03, SCS-16): sign-in rate limiting and lockout, failed sign-ins as security events, the My profile current-password limit (T-M2-15a security review), the client address for Auth's own limits |
| **Requirements** | FR-IAM-13 (lockout threshold; per-organization settings come with T-M2-10), FR-IAM-16, NFR-SEC-01 · approved screen 6 `Security.dc.html` (proposed defaults: lock after 5 failed attempts, for 15 minutes) |
| **Architecture** | ADR 0011 §4 (shared PostgreSQL limiter) and its implementation note T-M2-11, ADR 0003 §2 (limits before Auth is called) and its implementation note T-M2-11, ADR 0002 §7 (no Auth secret key in the web app), ADR 0009 §2 (no personal data in logs) |
| **Threats** | TM-0003 T-IAM-01 (credential stuffing / spraying), T-IAM-03 (client-IP spoofing), T-IAM-25 (failures as security events), T-IAM-27 (enumeration, timing), T-IAM-31 (Auth's shared budget), T-IAM-32 (lockout as a weapon); risk register R-34 |
| **Code** | Database: migration `20261013090000_private__rate_limiter.sql`, tests `supabase/tests/70–72_rate_limiter_*.sql` · store: `packages/platform-db/src/rate-limit.ts` (+ integration test) · policy, keys, events: `packages/platform-identity/src/auth-limits.ts` · flows: `auth-flow.ts` (sign-in), `password.ts` (My profile), `password-reset.ts`, `invitation-accept.ts`; wiring `auth-next.ts` · app: `apps/suite/src/lib/{client-ip,request-client,server-settings}.ts`, actions in `apps/suite/src/auth/` · audit of refused password changes: `defineAction` `auditFailure` (`packages/platform-rbac`) · self-hosted: `infra/docker/compose.yaml`, `gateway/nginx.conf` · E2E: `apps/suite/e2e/sign-in-limits.spec.ts` (self-hosted smoke) |

## 1. What is limited

Supabase Auth's own per-IP limits see the **app server's** address (every Auth call comes from the app), so they neither slow one attacker nor protect one account. The application therefore checks its own limits **before** asking Auth, on one set of counters in PostgreSQL shared by every app instance and Vercel function.

| Flow | Key | Platform default (per 15 minutes) | Answer when limited | When the limiter itself fails |
|---|---|---|---|---|
| Sign-in (and "sign in to accept" an invitation) | typed **e-mail** — existing account or not | **5 consecutive failures** lock it for 15 minutes from the 5th; a successful sign-in ends the run; a completed password reset unlocks | «أُوقف تسجيل الدخول مؤقتًا بعد محاولات كثيرة لم تنجح…» / "Sign-in is paused for now after too many unsuccessful attempts…" (`AUTH_TOO_MANY_ATTEMPTS`); **the right password is refused too** while locked | **Fail closed**: the generic «تعذّر إكمال الطلب بسبب خلل لدينا… المرجع» with a correlation id; Auth is not asked |
| | **client** (address; IPv6 by its /64) | 30 failures, 300 attempts (shared key without a trusted address: 300 / 3,000) | same | same |
| My profile: current-password check | **user** id | 5 checks | «طلبات كثيرة خلال وقت قصير…» (`RATE_LIMITED`); a wrong current password is audited | Fail closed (generic error) |
| Password reset request (screen 10) | client, then — only for an allowed client — account | 10 per client, 3 per account (shared: 100) | **the same answer** after the same 1.5 s; no e-mail | Treated as limited (same answer, no e-mail) |
| Password reset completion (screen 11) | client | 5 (shared: 100) | `RATE_LIMITED`; the link is **not** spent | Fail closed (generic error); the link stays usable |
| Invitation: new-account sign-up | client | 10 (shared: 100) | `RATE_LIMITED` | Fail closed |
| Invitation: link lookup | client | 60 (shared: 600) | `RATE_LIMITED` (the page shows it) | **Fail open** (logged): the 256-bit token cannot be guessed; nothing is checked against a credential |

After Auth has answered, counting a failure or ending a run of failures never changes the answer: a limiter failure there is logged (`auth.limiter.unavailable`, reasons `failure_not_counted`, `failures_not_cleared`, `lock_not_cleared`) and the next check fails closed while the limiter stays down. The error-tunnel limiter (`/api/monitoring/errors`) stays in memory per instance (ADR 0009 implementation note): it protects the tracker's quota, not a credential.

**No account enumeration** (NFR-SEC-01, TM-0003 T-IAM-27): counters are kept per typed e-mail whether or not an account exists, so an unknown address locks exactly like a real one, and the locked answer names no account state. Every refused sign-in — wrong e-mail or password, or limited — is answered **no sooner than 1.5 s** after the request started: GoTrue (v2.197.0, `ResourceOwnerPasswordGrant`) answers an unknown e-mail at once but compares the password of an existing account first, which would otherwise tell them apart by time. A successful sign-in is not slowed.

**Lockout as a weapon** (TM-0003 T-IAM-32): anyone can lock an account for 15 minutes by failing 5 times. The owner unlocks it at once by completing a password reset (the mailbox proves ownership); the account's run also ends after the window. Admin unlock and the proof-of-work challenge are follow-ups (§7).

**Per-organization settings** (T-M2-10): `limitsFor(context)` in `auth-limits.ts` is the single integration point — the organization's lockout threshold and duration (within platform floors: lockout cannot be disabled, T-IAM-24) replace the defaults there for a known organization (TM-0003 D-IAM-04: the platform default at the shared sign-in host, the host organization's policy on its own host). Callers do not change.

## 2. The shared limiter

`private.rate_limit_hit(bucket, subject, max_hits, window_seconds)` counts one hit and answers `(allowed, remaining, retry_after_seconds, key_ref)`; `rate_limit_peek` answers without counting (failure counters are checked before Auth and counted after it); `rate_limit_clear` forgets a key. Owned by the NOLOGIN guard role `rate_limit_guard`, `SECURITY DEFINER` with an empty `search_path`, executable only by `authenticated` and refusing every login role but `app_server` (`session_user`); the web app calls them in its usual claim-less `set local role authenticated` transaction, one call per transaction, with a 3 s statement timeout.

- **Counting** (fixed windows): the first hit opens a window of `window_seconds`; the hit that uses the budget up starts a **full** window from then (the lock lasts 15 minutes after the 5th failure, as screen 6 says); hits beyond are refused, capped at `max + 1`, and do not move the end.
- **Race-safe**: `INSERT … ON CONFLICT (bucket, key_hash) DO UPDATE` takes the key's row lock, so concurrent hits of one key serialise and never let more than `max` through (integration test: 40 parallel hits, exactly the limit allowed); other keys never wait.
- **Bounded retention without a job**: after its upsert each hit deletes up to 20 expired counters with `FOR UPDATE SKIP LOCKED` — the purge never waits, and since every transaction holds at most one counter it may wait for, no two calls can deadlock. Windows are at most 24 hours. The counters table is **UNLOGGED** (ADR 0011 §4): a database crash restarts every counter, which only loosens limits for a moment.
- **No readable key anywhere**: the app sends a *subject* — SHA-256 of `jadarat.rate-limit.v1`, the kind (`account`, `client`, `user`) and the normalised key — never the e-mail or address itself; the function refuses anything but 32 bytes. The database stores `HMAC-SHA-256(K, subject)` and returns `key_ref` = `rk_` + its first 12 bytes in hex for log correlation.
- **Where the HMAC key lives — decision (Tech Lead, T-M2-11): inside the database**, not in an environment secret. `private.rate_limit_secret` holds one 64-byte key `K` (as HMAC's padded inner/outer keys), generated by the migration from the server's strong random source (`gen_random_uuid`, 488 random bits), readable by `rate_limit_guard` only — never by `app_server`, `app_worker` or `authenticated` (pgTAP 70/71). Why: it is the same for every app instance and Vercel function **by construction** (an environment secret could be missing or differ between deployments, silently splitting the counters or stopping sign-in), there is nothing to distribute, rotate in two places or leak from a deployment's settings, and sovereign installations need no extra step. The cost — the key sits next to the counters in a database dump — is small: counters live minutes, hold no readable key, and the database already holds the accounts' e-mail addresses.
- **Rotating the key** (e.g. after a database dump leaked): a migration that replaces the row (`update private.rate_limit_secret set inner_key = …, outer_key = …` built like the original `DO` block). Every counter starts again; nothing else changes.

## 3. The client address

From `apps/suite/src/lib/client-ip.ts` only (TM-0003 T-IAM-03): the header the platform in front of the app **overwrites** — `x-real-ip` on Vercel, otherwise the header named in `JADARAT_CLIENT_IP_HEADER` — and only when it holds a single IP address; IPv6 is keyed by its /64 (one subscriber's prefix). Anything else (`X-Forwarded-For`, several values, a header the platform does not overwrite) gives **no** client key, and every such visitor shares one key with larger budgets (§1). **Self-hosted production must set `JADARAT_CLIENT_IP_HEADER`** (README of `infra/docker`): without it one abuser can use up the shared budgets for everyone.

## 4. Security events and alerting

Failed sign-ins and limits are **security events** in the app's JSON logs (ADR 0009 §2: codes and keyed references only — never an e-mail, address, password or token; the smoke test scans for them). Fields: `security_event`, `action` (the flow), `reason`, `limit`, `retry_after_s`, `subject_ref` (the account or user), `client_ref` (the client), `outcome`, and `entity_type`/`entity_id` (user id) for a signed-in user. Event names follow TM-0003 T-IAM-25:

| `security_event` | Level | When | `reason` |
|---|---|---|---|
| `auth.sign_in.failed` | warn | Auth refused the credentials (wrong e-mail or password; also "sign in to accept") | `invalid_credentials` |
| `auth.lockout` | warn | A failure used a budget up: the lock starts now | `sign_in.account_failures` (the account), `sign_in.client_failures` (the client) |
| `auth.rate_limited` | warn | An attempt refused by a limit before Auth was asked, or by Auth's own limit | the limit (`sign_in.account_failures`, `password_check.user`, `password_reset.request_client`, …) or `auth_service` |
| `auth.password_change.failed` | warn | My profile: wrong current password | `current_password` |
| `auth.limiter.unavailable` | **error** | The limiter could not answer | `fail_closed`, `fail_open`, `failure_not_counted`, `failures_not_cleared`, `lock_not_cleared` |

**Tenant audit**: failed sign-ins happen before any organization is known, so they are platform security events, not tenant audit rows (TM-0003 F-IAM-06: a platform-level event store with a tenant projection is a follow-up). Where the organization is known — a signed-in member's wrong current password on My profile — the audit trail gets `platform.auth.password_change_failed` (`entity_type` `user`, data `{ reason: current_password }`, no password). Limited attempts are logged as `auth.rate_limited` but not audited, so the audit rows per member stay bounded by the limit (5 per 15 minutes). Integration point for T-M2-10: a failed MFA step (organization known after the password) audits the same way through `defineAction`'s `auditFailure`.

**Alerting queries** (starting thresholds; tune on real traffic). Loki/LogQL for the collector of ADR 0009 §5 (logs from `service="suite-web"`):

```logql
# Sign-in failure spike (credential stuffing / spraying) — warn
sum(count_over_time({service="suite-web"} | json | security_event="auth.sign_in.failed" [5m])) > 50
# Many accounts locked at once (spraying, or lockout used as a weapon) — page
sum(count_over_time({service="suite-web"} | json | security_event="auth.lockout" | limit="sign_in.account_failures" [15m])) > 10
# One account hammered while locked (distributed attack on one person) — warn
sum by (subject_ref) (count_over_time({service="suite-web"} | json | security_event="auth.rate_limited" | reason="sign_in.account_failures" [15m])) > 20
# The limiter is down: sign-in fails closed — page at once
sum(count_over_time({service="suite-web"} | json | security_event="auth.limiter.unavailable" | reason="fail_closed" [5m])) > 0
```

Until the collector exists: Vercel → project → **Logs**, search `auth.lockout` / `auth.limiter.unavailable` (runtime logs keep days only); self-hosted:

```bash
docker compose --env-file .secrets/.env logs --no-log-prefix app | jq -c 'select(.security_event != null)'
docker compose --env-file .secrets/.env logs --no-log-prefix app |
  jq -r 'select(.security_event == "auth.lockout") | .subject_ref' | sort | uniq -c | sort -rn | head
```

## 5. Auth's own per-IP limits

- **Hosted Supabase: not forwarded.** Supabase accepts a trusted visitor address from a server only in `Sb-Forwarded-For` on requests made with the **secret key**; the web app holds no Auth secret key (ADR 0002 §7) and must not get one for this. So hosted Auth's per-IP limits keep seeing the app's egress address: they are a ceiling for the whole product (set them high enough in the dashboard — PO steps in `password-reset.md` §6), and the per-visitor and per-account protection is the application limiter above. Sending the visitor's address to Supabase would also hand a sub-processor personal data for nothing.
- **Self-hosted: forwarded through the gateway** (`infra/docker`). GoTrue applies its per-IP limits (sign-in and refresh, verify, sign-up, password change) **only** when `GOTRUE_RATE_LIMIT_HEADER` is set (GoTrue v2.197.0 `performRateLimitingWithHeader`: no header configured → no limit; header configured but empty → no limit for that request). The stack sets it to `X-Jadarat-Rate-Limit-Key`, which the gateway **always** sets itself:
  - from the app's network (`edge`, `10.231.0.32/28`; `.33` is the bridge, i.e. the host through a published port): the visitor key the app sends in `X-Jadarat-Client` (`JADARAT_AUTH_CLIENT_HEADER` on the app; the app's trusted client address, IPv6 by /64) — so Auth counts visitors, not the app;
  - from the app without a trusted visitor address: no key, so Auth limits nothing for that call (one budget for every visitor would let one abuser block everyone); the app's shared limiter applies alone;
  - from anywhere else (a direct caller): its own address, whatever it sends — it cannot pick its key.
  The smoke test proves all four cases. The two subnets in `compose.yaml` and `gateway/nginx.conf` change together. Auth's port should not be reachable from the internet at all: the browser never calls Auth (every flow is a server action).

## 6. Operations

| Situation | What to do |
|---|---|
| **Deploying this change** | The migration must be applied with the app: until `DB deploy` (plan → apply) has run, the limiter functions do not exist and **sign-in fails closed** (generic error with a reference), a reset request sends nothing, My profile password changes fail. On staging run `DB deploy` right after the merge; the app needs no new setting. |
| A person is locked out | It ends 15 minutes after the 5th failure, or at once when they complete **Forgot password?** (the reset unlocks). An operator can unlock by hand as the migration role (hosted: Supabase SQL editor; self-hosted: `psql` as `postgres`) — the e-mail is used only inside this one statement: `delete from private.rate_limit_counters where bucket = 'sign_in.account_failures' and key_hash = private.rate_limit_key(sha256(convert_to(E'jadarat.rate-limit.v1\naccount\n' \|\| lower(normalize(btrim('person@example.com'), NFC)), 'UTF8')));` |
| `auth.limiter.unavailable` with `fail_closed` | Sign-in is down. Check the database (`/api/health/ready`), that migration `20261013090000` is applied (`select to_regprocedure('private.rate_limit_hit(text,bytea,integer,integer)')`), and the app's database connection (`DATABASE_URL_APP_SERVER`). |
| A whole office is refused | Many people behind one address can reach the per-client budgets (30 failures / 300 attempts in 15 minutes). Raise them in `PLATFORM_AUTH_LIMITS` (`auth-limits.ts`) or, with T-M2-10, per organization. |
| Counter table size | `select bucket, count(*) from private.rate_limit_counters group by 1;` (migration role). It is bounded by the attempts in the longest window; expired rows go with the next hits. |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | **Tests only** (the self-hosted smoke sets 20): every window, the lock included, lasts that many seconds. The app logs a warning at start-up when it is set; never set it in an installation. |

## 7. Known limits and follow-ups

1. **Session refresh** in the request proxy is not limited per client yet (TM-0003 T-IAM-31: forged session cookies that make the proxy call Auth's refresh). It needs a cheap per-request check in the proxy (malformed cookies dropped without an Auth call first).
2. **Direct calls to hosted Auth** (`/auth/v1/token` with the public URL and publishable key) bypass the application limiter (TM-0003 T-IAM-02, F-IAM-01): Auth's Password Verification Attempt hook backed by the same counters, or the accepted residual risk RR-IAM-01 — a PO decision with T-M2-10.
3. **Proof-of-work challenge** after repeated failures (ADR 0003 §2, TM-0001 F-05) and **admin unlock** from the user profile (T-M2-10 security settings).
4. **Platform security-event store** (TM-0003 F-IAM-06) with a projection into each organization's audit for its members; alert rules live in the collector once it exists (ADR 0009 §5).
