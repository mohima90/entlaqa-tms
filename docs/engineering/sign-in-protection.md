# Sign-in protection (runbook)

| | |
|---|---|
| **Backlog** | T-M2-11 (carry-over from T-M1-D03, SCS-16): sign-in rate limiting and lockout, trusted browsers, the lockout e-mail, the Organization Admin's unlock, failed sign-ins as security events, the My profile current-password limit (T-M2-15a security review), the client address for Auth's own limits; hooks for T-M2-10 (authenticator codes, organization lockout policy) |
| **Requirements** | FR-IAM-13 (lockout; per-organization settings with T-M2-10), FR-IAM-12 (authenticator codes), FR-IAM-16, NFR-SEC-01 · approved screen 6 `Security.dc.html` (lock after 5 failed attempts for 15 minutes; «تذكّر الجهاز الموثوق» 30 days) |
| **Decisions** | PO, 9 Oct 2026: smart lock (trusted browsers keep signing in; the lockout e-mail; Organization Admin unlock — not HR), per-client budgets (successes do not count; 100 wrong passwords per 15 minutes per address), hosted direct-Auth bypass accepted as RR-IAM-01 until the production Supabase plan decision, **remembered browsers are opt-in** («تذكّر هذا المتصفح», unticked by default; from finding L1) · security review of T-M2-11 (first round: fixes 1–10; second round "approve with fixes": M1–M3, L1–L6 and the info items, 10 Oct 2026) |
| **Architecture** | ADR 0011 §4 (shared PostgreSQL limiter) and its implementation note T-M2-11, ADR 0003 §2 (limits before Auth is called) and its note, ADR 0002 §7 (no Auth secret key in the web app), ADR 0009 §2 (no personal data in logs) and its note on keyed references |
| **Threats** | TM-0003 T-IAM-01 (stuffing / spraying), T-IAM-03 (client-IP spoofing), T-IAM-12 (code guessing), T-IAM-25 (security events), T-IAM-27 (enumeration, timing), T-IAM-31 (Auth's shared budget), T-IAM-32 (lockout as a weapon); RR-IAM-01; risk register R-34 |
| **Code** | Database: migrations `20261013090000_private__rate_limiter.sql`, `20261013090100_private__account_locked_mail.sql`, tests `supabase/tests/70–72_rate_limiter_*.sql` · store: `packages/platform-db/src/rate-limit.ts`, `sign-in-lock.ts` (+ tests, integration test) · budgets (one config): `packages/platform-identity/src/auth-limits-config.ts` · policy, keys, events: `auth-limits.ts` · flows: `auth-flow.ts`, `password.ts`, `password-reset.ts`, `invitation-accept.ts`, `mfa.ts` (codes, T-M2-10); wiring and the trusted-device cookie `auth-next.ts` · e-mails: `platform-notifications` `templates/account-locked.ts`, `templates/sign-in-unlocked.ts`, worker `platform-identity/src/jobs/account-mailer.ts` · unlock: `platform-rbac` `iam/sign-in-lock.ts`, profile page, `components/users/unlock-sign-in.tsx` · sign-in page: `components/auth/sign-in-form.tsx` («تذكّر هذا المتصفح») · app settings: `apps/suite/src/lib/{client-ip,request-client,server-settings}.ts` · self-hosted: `infra/docker/compose.yaml`, `compose.smoke.yaml`, `front/nginx.conf`, `gateway/nginx.conf` · E2E: `apps/suite/e2e/sign-in-limits.spec.ts` (self-hosted smoke), `e2e/smoke.spec.ts` (the tick box, every CI run) |

## 1. What is limited

Supabase Auth's own per-IP limits see the **app server's** address (every Auth call comes from the app), so they neither slow one attacker nor protect one account. The application therefore counts **before** asking Auth, on one set of counters in PostgreSQL shared by every app instance and Vercel function.

| Flow | Key | Platform default (per 15 minutes) | Answer when limited | When the limiter itself fails |
|---|---|---|---|---|
| Sign-in (and "sign in to accept" an invitation) | typed **e-mail** — existing account or not — from a browser the account does **not** trust | **5 consecutive failures** lock it for 15 minutes from the 5th; a success ends the run; a completed password reset (which also trusts its browser) or the Organization Admin unlocks | «أُوقف تسجيل الدخول مؤقتًا بعد محاولات كثيرة لم تنجح…» / "Sign-in is paused for now after too many unsuccessful attempts…" (`AUTH_TOO_MANY_ATTEMPTS`); **the right password is refused too** while locked | **Fail closed**: the generic «تعذّر إكمال الطلب بسبب خلل لدينا… المرجع» with a correlation id; Auth is not asked |
| | e-mail **+ remembered browser** (§3: «تذكّر هذا المتصفح» ticked, or the browser that completed a reset) | 10 failures (the account's lock does **not** apply); using them up requests the lockout e-mail too | same | same |
| | **client** (address; IPv6 by its /64) | **100 wrong passwords** (successes are given back) and 1,000 attempts; shared key without a trusted address: 1,000 / 10,000 | same | same |
| Authenticator code — and the e-mailed set-up code and the reset page's code (T-M2-10, §6) | **user**, and client | 5 wrong codes (consecutive), client 100 (shared 1,000) | `RATE_LIMITED` | Fail closed |
| My profile: current-password check | **user** id | 5 checks | «طلبات كثيرة خلال وقت قصير…» (`RATE_LIMITED`); a wrong current password is audited | Fail closed (generic error) |
| Password reset request (screen 10) | client, then — only for an allowed client — account | 10 per client, 3 per account (shared: 100) | **the same answer** after the same 1.5 s; no e-mail | Treated as limited (same answer, no e-mail) |
| Password reset completion (screen 11) | client | 5 (shared: 100) | `RATE_LIMITED`; the link is **not** spent | Fail closed (generic error); the link stays usable |
| Invitation: new-account sign-up | client | 10 (shared: 100) | `RATE_LIMITED` | Fail closed |
| Invitation: link lookup | client | 60 (shared: 600) | `RATE_LIMITED` (the page shows it) | **Fail open** (logged): the 256-bit token cannot be guessed |

All sign-in budgets are **one config** (`PLATFORM_AUTH_LIMITS.signIn` in `auth-limits.ts`); `limitsFor(context)` is where per-organization values join (T-M2-10), `signInBudgets(limits, client)` where trusted office ranges would (§7).

**Counted before Auth** (security review HIGH 1): one database call (`private.rate_limit_sign_in_check`) counts the client's attempt and, provisionally, a failure for the client and for the account (or the trusted browser), and refuses when a budget is used up. The 5th wrong attempt still reaches Auth; the 6th is refused without asking it; 30 parallel attempts on one account get at most 5 Auth calls (unit and integration tests). When Auth accepts the password, one call (`rate_limit_sign_in_succeeded`) gives the client's provisional failure back, ends the run and — **only with «تذكّر هذا المتصفح» ticked** — trusts the browser (§3). A wrong password needs no further database call — unless this failure used the account's or a trusted browser's budget up: then the lockout e-mail is requested (§4). **Auth answering 429** compared no password: one call (`rate_limit_sign_in_not_checked`) gives the account's (or trusted browser's) provisional failure back — a flood Auth refused by itself must not lock the account — and the client's failure stays counted (security review L6). Auth answering 5xx keeps every provisional count. An attempt the account refuses gives the client's failure back (it is no wrong password).

**No account enumeration** (NFR-SEC-01, TM-0003 T-IAM-27): counters are kept per typed e-mail whether or not an account exists, so an unknown address locks exactly like a real one; the locked answer names no account state; the lockout e-mail request is made for any address and the worker decides. Every refused sign-in — wrong e-mail or password, or limited — is answered **no sooner than 1.5 s** after the request started (GoTrue answers an unknown e-mail at once but compares the password of an existing account first); a refusal whose work took longer than 1.2 s is logged (`refusal_padding_exceeded`, codes only). A trusted browser behaves differently only for an account that signed in with it — whoever holds it knows the account. Addresses that are not printable ASCII after normalisation (Auth accepts ASCII addresses only; the sign-in form refuses them) share one account subject, and İ/Σ are lower-cased as GoTrue does, so no spelling of an address gets a fresh budget. Accepted residuals (TM-0003 T-IAM-27): "a success ends the run" tells a patient attacker whether someone signed in to an address meanwhile, and an organization's stricter lockout policy tells membership of the host's organization — each only at the cost of failures toward the lock and its e-mail to the owner.

**Lockout as a weapon** (TM-0003 T-IAM-32): anyone can lock an account for unknown browsers by failing 5 times. The owner keeps signing in from the browsers they chose to remember (§3), gets the lockout e-mail (at most one a day), and can end the lock at once with a password reset — which also trusts the browser used for it (24 hours, or 30 days with «تذكّر هذا المتصفح» ticked on the reset page), so an attacker who keeps locking the account cannot keep its owner out (security review M2, re-review N1); the Organization Admin can unlock it from the profile (§5).

## 2. The shared limiter

Owned by the NOLOGIN guard role `rate_limit_guard`, `SECURITY DEFINER` with an empty `search_path`, executable only by `authenticated` and refusing every login role but `app_server` (`session_user`); the web app calls them in claim-less `set local role authenticated` transactions with a 3 s statement timeout — **never inside another transaction of the same pool** (security review MEDIUM 2: `defineAction`'s `beforeTransaction` runs the My profile limit before the action's transaction; regression test with a pool of 2).

| Function | Use |
|---|---|
| `rate_limit_hit` / `_clear` / `_give_back` | generic counters (password check, reset, invitations; codes: failures only). There is no "peek": every read of a limit counts |
| `rate_limit_sign_in_check` / `_sign_in_succeeded` / `_sign_in_not_checked` | sign-in, before Auth, after Auth accepted, after Auth's own 429 |
| `rate_limit_sign_in_reset` / `rate_limit_forget_other_devices` | a completed password reset (§3); a My profile password change (§3) |
| `member_sign_in_lock` / `unlock_member_sign_in` | Organization Admin, with the admin's claims (§5); the unlock is in migration `20261013090100` |
| `sign_in_account_in_tenant` | is a typed address an active member of the host's organization (its lockout policy then applies, §6) |
| `rotate_rate_limit_keys` | owner only: new keys |

- **Counting**: fixed windows; with *lock* semantics the hit that uses the budget up starts a **full** window (the lock lasts 15 minutes after the 5th failure); hits beyond are refused, capped at `max + 1`. Client budgets keep their window (a plain rate). `retry_after_seconds` never exceeds the window.
- **Race-safe and deadlock-free**: `INSERT … ON CONFLICT DO UPDATE` takes the key's row lock; every function locks in one order — the client's counters, then the account's advisory lock (where its trusted browsers change), then the account's or browser's counter, then its trusted browsers; purges (20 expired counters and trusted browsers per call) come last with `SKIP LOCKED`. Counters are **UNLOGGED**: a crash, an **HA failover** or the **promotion of a replica** starts them all again (unlogged tables are emptied on crash recovery and are not replicated) — every lock and budget restarts, which only loosens the limits for one window; trusted browsers and the keys are logged tables and survive. Expect a burst of `auth.lockout` / `auth.rate_limited` to fall silent after a failover: that is this, not an attack ending.
- **No readable key anywhere**: the app sends *subjects* — SHA-256 of `jadarat.rate-limit.v1`, the kind (`account`, `client`, `user`, `device`) and the normalised key — never the e-mail, address or cookie token; the database stores `HMAC-SHA-256(counter key, subject)`. Log references `rk_…` are 12 bytes of `HMAC-SHA-256(log key, subject)` — a **separate key** (security review LOW 5), so a log line never repeats a stored key. Only `sign_in_account_in_tenant` and the lockout e-mail request receive a typed address (compared or queued, never stored by the limiter or logged).
- **Where the keys live — inside the database** (decision, Tech Lead): `private.rate_limit_secret` holds the counter key and the log key (as HMAC's padded keys), generated by the migration from the server's strong random source, readable by `rate_limit_guard` only. They are the same for every instance by construction and need no distribution. **The pseudonymisation rests on the database's confidentiality**: anyone who can read the table — a superuser, a role with `pg_read_all_data`, a database **backup** or dump — can test guessed e-mails or addresses against counters and log references. Treat backups like the database itself (ADR 0009 note T-M2-11).
- **Rotating the keys** (e.g. after a backup leaked): as the migration role, `select private.rotate_rate_limit_keys();` — it replaces both keys of the one row (and refuses unless exactly one row changed), and every counter and trusted browser starts again (people sign in once more to be trusted again).

## 3. Remembered (trusted) browsers (PO decisions 9 Oct 2026; screen 6, 30 days)

**Opt-in.** The sign-in page has a check box «تذكّر هذا المتصفح» / "Remember this browser", **unticked by default**, with its explanation tied to it (`aria-describedby`): «يبقى بإمكانك الدخول من هذا المتصفح 30 يومًا حتى إن أُوقف تسجيل الدخول إلى حسابك مؤقتًا بسبب محاولات من مكان آخر. لا تختره على جهاز مشترك.» / "For 30 days, you can still sign in from this browser even if sign-in to your account is paused after attempts from elsewhere. Don't tick this on a shared computer." A native check box: Tab reaches it after the password, Space ticks it, screen readers read the label and the explanation. The reset page (screen 11) has the same box, unticked by default (security re-review N1), explained as «إن اخترته، يبقى بإمكانك الدخول من هذا المتصفح 30 يومًا … وإن لم تختره، فليوم واحد فقط. لا تختره على جهاز مشترك.» / "If ticked, you can still sign in from this browser for 30 days …; if not, for one day only. Don't tick this on a shared computer." "Sign in to accept" an invitation has no such box and never remembers. Arabic copy to be confirmed by the UX writer.

| What | Trust |
|---|---|
| Successful sign-in, box **ticked** | Created, or renewed for 30 days from now (sliding) |
| Successful sign-in, box **not ticked** | Unchanged — a browser already trusted stays trusted **until its date** and then expires; an unknown browser stays unknown and gets no cookie |
| Completed **password reset** (screen 11), box **not ticked** | The browser that completed it becomes trusted for **24 hours** — enough to ride out a lock attack (security review M2: the owner is not stranded while an attacker keeps the account locked) without remembering the browser unasked (re-review N1); a longer trust it already has is kept. **Every other** browser of the account is forgotten |
| Completed **password reset**, box **ticked** | The browser that completed it becomes trusted for 30 days; every other browser is forgotten |
| Password change on **My profile** | Every browser of the account but the current one is forgotten (security review L2); done right after the action's transaction |
| Key rotation (§2) | Every trust ends |

The browser's cookie `__Host-jadarat-device` (HttpOnly, Secure, SameSite=Lax, path `/`; `jadarat-device` under `next dev`) holds a random 256-bit token — never the account, never readable by scripts — and is written only when trust is created or renewed, with a Max-Age up to the **latest** end of any trust of its token (one cookie serves every account that trusts the browser, so a 24-hour reset trust for one account never cuts another's 30 days). Trust periods are exact 24-hour multiples (`trustedDevice.days` / `resetDays` in `PLATFORM_AUTH_LIMITS`), and a trust is never shortened. The database records `(HMAC(account subject), HMAC(token subject)) → expiry` in `private.sign_in_trusted_devices`; one cookie serves every account that trusts that browser; at most 10 browsers per account (the ones whose trust ends first go). **The server only ever trusts tokens it issued**: a presented token is reused only when the server already knows it (an unexpired trust of any account); otherwise — a cookie the server never saw, an expired or a forged one — the app's fresh random token is trusted and replaces the cookie. A trusted browser is **not stopped by its account's lock**; it has its own budget of 10 failures per 15 minutes, and its success ends only its own run (not the account's lock); using its budget up requests the lockout e-mail (§4: a stolen cookie must not guess unnoticed). Unknown browsers get the lock as before.

Implementation choice: TM-0003 IA-02 asks for "cookie + hashed server record". A stateless signed cookie (HMAC over account, device id and expiry, with a per-account epoch for revocation) would need the account id before Auth — an account lookup on every sign-in — and revocation state anyway; the server record needs neither and revokes cleanly. The HMAC with a server key is the database's (§2).

## 4. The lockout e-mail (PO decision 9 Oct 2026)

When a failure uses the account's budget up (the 5th from unknown browsers) — or a remembered browser's own budget (security review L1) — the app requests `private.request_account_locked_mail(typed e-mail, lock minutes)` (migration `20261013090100`; one waiting request per address). The T-M2-17 account mailer (worker) answers it like a reset request: an unknown address, a banned account or one without an active membership gets **nothing**; otherwise `platform.account_locked` goes out in the organization's brand and the person's language (Arabic first): what happened; that it lifts by itself after the lock's minutes; that browsers remembered with «تذكّر هذا المتصفح» still sign in; a "set a new password" link (the forgot-password page — nothing that signs anyone in), and that a new password ends the pause at once, lets the browser used for it sign in for a day even under a new pause — 30 days if «تذكّر هذا المتصفح» is ticked there — and makes the others sign in again; to tell the Organization Admin if it wasn't them; and that we send it **at most once a day**. Arabic copy to be confirmed by the UX writer.

Caps (security review M3; the lock itself is never affected — only the e-mail is left out, logged by the worker as `already_notified` or `hourly_cap` at info, and `organization_hourly_cap` as a **warning**, re-review N4 — a spray against an organization is worth a look):

| Cap | Value | Where |
|---|---|---|
| Per person | **1 per 24 hours** | `PLATFORM_AUTH_LIMITS.lockoutMail.personQuietHours` (worker: e-mails of this template to the person in the organization) |
| Per organization | **50 per hour** (a spray across a whole organization must not become a mail flood) | `PLATFORM_AUTH_LIMITS.lockoutMail.tenantPerHour` |
| Per person, every account e-mail | 5 an hour | `ACCOUNT_MAIL_HOURLY_CAP` (T-M2-17) |

A failure to queue is logged (`lock_mail_not_requested`), never answered.

## 5. Unlock by the Organization Admin (PO decision 9 Oct 2026)

On a member's profile (screen 3), an Organization Admin (`platform.user.unlock_sign_in`, `tenant_admin` only — HR cannot — medium risk) sees «تسجيل الدخول موقوف مؤقتًا» while — and only while — the member's account is locked, with «إلغاء إيقاف تسجيل الدخول». Only **active** members (security review M1): a revoked, suspended or invited membership shows nothing and cannot be unlocked (pgTAP negative test). The database checks again that the caller is an active Organization Admin of the session's organization and the person an active member there; it looks the member's address up itself, so the web app never sees it or a key; another organization's person reads as "not locked". The lock is measured against the account budget sign-in applies (the same as the profile's lock state): a run of failures below it is no lock — nothing changes, counts or is e-mailed.

- **At most 3 unlocks per account in 24 hours** (shared limiter, bucket `sign_in.unlock_account`): an admin — or a stolen admin session — cannot keep reopening an account under attack. A 4th is refused with «أُلغي إيقاف تسجيل الدخول إلى هذا الحساب 3 مرات خلال آخر 24 ساعة…» / "Sign-in to this account was unlocked 3 times in the last 24 hours…"; the owner's own password reset still ends the lock.
- **The owner is e-mailed every time** (`platform.sign_in_unlocked`, through the account-mail pipeline, in the unlocking organization's brand, bilingual): the organization's administrator ended the pause; if the attempts were not theirs or they did not ask for it, set a new password and tell the Organization Admin. It names the organization, never the administrator; the worker logs kinds and codes only.
- The unlock is audited (`platform.user.sign_in_unlocked`, `entity_type` `person`); when the lock had lifted meanwhile, or the unlock was refused, the answer says so and nothing is audited. The member's trusted browsers are not touched.

## 6. With T-M2-10: codes and the organization's lockout policy (integrated 10 Oct 2026)

- **Authenticator codes** (TM-0003 T-IAM-12): Auth's per-IP limit sees only the app server. `withCodeAttemptLimit(codeAttemptLimiterForRequest(client), userId, () => verifyTotpCode(…), (e) => e.code === 'MFA_CODE_INVALID')` limits the code check per account (5 wrong codes, consecutive) and per client (100), counting **wrong codes only** (a right code gives its provisional failure back); fail closed; events `auth.mfa_code.failed`, `auth.lockout` (`mfa_code.*`). **Wired** for every code check: the flows require a `CodeCheckLimit` (`auth-limits.ts`; `codeCheckLimitFor(client, action)` in `auth-next.ts`, `NO_CODE_CHECKS` — failing closed — for flows that check none): `verifyTotpCode` (sign-in, step-up, a set-up's first code; `platform.auth.mfa_verify`), `confirmMfaSetup` (the e-mailed set-up code, on top of the database's 5 tries per code and 15 a day per account; `platform.auth.mfa_confirm`) and the reset page's code (`platform.auth.password_reset` — the link is spent by then, so a limited check asks for a new link). The suite's MFA actions pass the request's client. All share the account's `mfa_code.account` budget.
- **Organization lockout policy** (`getLockoutPolicy`, T-M2-10): `organizationAccountLockout({ hostTenantId, lockoutPolicyFor: getLockoutPolicy, accountInTenant: signInAccountInTenant }, limits.signIn.accountFailures)` as the guard's `accountLockout` — the host organization's threshold and duration apply **only to its own active members**; every other address gets the platform default (5 / 15 minutes), so an attacker cannot pick the laxest organization's host. The policy is **clamped to the default or stricter** (security review L5): at most 5 failures, at least 15 minutes (T-M2-10's settings allow 3–5 failures and 15–60 minutes, so the clamp only guards against a bad value). **One budget everywhere** (security re-review N7): `accountLockoutBudget(account, lockoutPolicyFor, fallback)` in `auth-limits.ts` is THE budget for an account on a host — the guard's `organizationAccountLockout` builds on it, and so does platform-rbac's `memberLockBudget(lockoutPolicyIn)` for the Organization Admin's views (the member is an active member of the admin's organization, so its policy applies, clamped the same way). **Wired**: the guard (`signInGuardFor` in `auth-next.ts`) uses `organizationAccountLockout` with T-M2-10's `getLockoutPolicy` and `signInAccountInTenant`; the host organization comes from `hostTenantIdForRequest()`. **One host rule** (integration review L1): `lockoutHostTenant(organizationHost)` in `auth-limits.ts` decides the host for sign-in **and** for the Organization Admin's views — the organization's own host only once organizations have one (`ORGANIZATION_SIGN_IN_HOSTS`, the integration point of ADR 0002 §4 host → tenant resolution; the proxy only classifies the Host header today), otherwise null = the platform default. So today every sign-in is on the platform's host and gets the platform default, as TM-0003 D-IAM-04 decides for that host — and so do the profile's lock state and the unlock: platform-rbac's `organizationMemberLockBudget` = `memberLockBudget(lockoutPolicyIn, hostOf = lockoutHostTenant)` measures against the **same** 5 failures (the organization's policy is not even read), so the profile never shows a pause sign-in does not apply, and an unlock never spends one of the 3 daily unlocks — nor e-mails the owner — for one. Once organization hosts exist, the policy is read by `getSecurityPolicy(tx)` **in the admin's own transaction** — never T-M2-10's pre-session `getLockoutPolicy`, which opens another transaction of the pool (security review MEDIUM 2). Screen 6 says where the settings apply (the organization's own address; the platform default on the shared sign-in page). Residual (TM-0003 T-IAM-27): a stricter policy makes the number of attempts before the lock depend on membership of the host's organization — observable only by locking the account, which e-mails its owner.

## 7. The client address

From `apps/suite/src/lib/client-ip.ts` only (TM-0003 T-IAM-03): the header the platform in front of the app **overwrites** — `x-real-ip` on Vercel, otherwise the header named in `JADARAT_CLIENT_IP_HEADER` — and only when it holds a single IP address; IPv6 is keyed by its /64. Anything else gives **no** client key, and every such visitor shares one key with larger budgets.

**Self-hosted production requires `JADARAT_CLIENT_IP_HEADER`** and a proxy in front of the app that overwrites that header, with the app's port reachable through it only. The reference stack does exactly that (`infra/docker`: the `front` proxy sets `X-Real-IP` and is the app's only published port; the compose default is `x-real-ip`; the smoke test checks the port and the start-up log). Since the security review (L4):

- A **production server outside Vercel that names its environment** (`NODE_ENV=production`, `VERCEL` not `1`, and `JADARAT_ENVIRONMENT` set to **any** value — `self-hosted`, `production`, `ksa-prod`…; the rule does not depend on the free-form label's spelling, security re-review N2) **refuses to start** without the setting — one abuser could otherwise use up the shared budgets for everyone. An installation that knowingly runs without a trusted header sets `JADARAT_CLIENT_IP_HEADER=none`: it starts, and logs an **ERROR** at every start (`client_ip_header_missing`), as does any other production server without a header (but Vercel). Local and test production builds (`next start`, the CI E2E server) set no `JADARAT_ENVIRONMENT` and keep starting; Vercel (staging sets `JADARAT_ENVIRONMENT=staging`) uses its own `x-real-ip`.
- **`X-Forwarded-For` is refused** as the setting (and an invalid header name): a proxy appends to it, so the visitor chooses its first address.
- **`front` behind a load balancer** (L3): `front` takes the address of whatever connects to it. Behind a TLS load balancer either replace `front` with the load balancer (which must overwrite the header) or uncomment `set_real_ip_from <load balancer>` + `real_ip_header <its header>` in `infra/docker/front/nginx.conf` (`infra/docker/README.md`).

Trusted office ranges per organization (PO decision 9 Oct 2026: later): `signInBudgets(limits, client)` is the integration point — a client inside an organization's registered range would get wider client budgets there; the account and browser budgets stay.

## 8. Security events and alerting

Failed sign-ins and limits are **security events** in the app's JSON logs (ADR 0009 §2: codes and keyed references only). Fields: `security_event`, `action`, `reason`, `limit`, `retry_after_s`, `subject_ref`, `client_ref`, `outcome`, and `entity_type`/`entity_id` (user id) for a signed-in user.

| `security_event` | Level | When | `reason` |
|---|---|---|---|
| `auth.sign_in.failed` | warn | Auth refused the credentials | `invalid_credentials` |
| `auth.lockout` | warn | A failure used a budget up: the lock starts now | `sign_in.account_failures`, `sign_in.device_failures`, `sign_in.client_failures`, `mfa_code.*` |
| `auth.rate_limited` | warn | Refused by a limit before Auth was asked, or by Auth's own limit | the limit, or `auth_service` |
| `auth.password_change.failed` | warn | My profile: wrong current password | `current_password` |
| `auth.mfa_code.failed` | warn | Wrong authenticator code (T-M2-10 hook) | `invalid_code` |
| `auth.limiter.unavailable` | **error** | The limiter could not answer | `fail_closed`, `fail_open`, `success_not_recorded`, `lock_mail_not_requested`, `lock_not_cleared` (reset), `failure_not_given_back` (Auth's 429, codes), `devices_not_forgotten` (My profile change) |

**Tenant audit**: failed sign-ins happen before any organization is known — platform security events, not tenant audit rows (TM-0003 F-IAM-06). Where the organization is known: `platform.auth.password_change_failed` (wrong current password; `auditFailure` receives the error and the actor only, never the input) and `platform.user.sign_in_unlocked`.

**Alerting queries** (starting thresholds). Loki/LogQL for the collector of ADR 0009 §5:

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

Until the collector exists: Vercel → project → **Logs**, search `auth.lockout` / `auth.limiter.unavailable`; self-hosted:

```bash
docker compose --env-file .secrets/.env logs --no-log-prefix app | jq -c 'select(.security_event != null)'
```

## 9. Auth's own per-IP limits

- **Hosted Supabase: not forwarded.** Supabase accepts a trusted visitor address only in `Sb-Forwarded-For` on requests with the **secret key**, which the web app never holds (ADR 0002 §7). Hosted Auth's per-IP limits keep seeing the app's egress address: a ceiling for the whole product (set them high enough — `password-reset.md` §6).
- **Direct calls to hosted Auth** (`/auth/v1/token` with the public URL and publishable key) bypass the application limiter: **accepted residual risk RR-IAM-01** (PO decision 9 Oct 2026) until the production Supabase plan decision — then reviewed (Auth's Password Verification Attempt hook backed by these counters, or a plan feature). Monitoring: Auth logs.
- **Self-hosted: forwarded through the gateway**. GoTrue applies its per-IP limits only with `GOTRUE_RATE_LIMIT_HEADER`; the gateway always sets `X-Jadarat-Rate-Limit-Key` itself: the visitor key the app sends in `X-Jadarat-Client` from the app's network (`edge`, `10.231.0.32/28`), nothing for an app call without a trusted address, and the caller's own address for anyone else. The smoke test proves all cases. `JADARAT_AUTH_CLIENT_HEADER` is **refused on Vercel** (`VERCEL=1`): set there by mistake it would send visitors' addresses to hosted Auth.

## 10. Operations

| Situation | What to do |
|---|---|
| **Deploying this change** | Apply both migrations (`DB deploy`, plan → apply) **right after the merge**: until then the limiter's functions are missing — `/api/health/ready` answers 503 (it checks the request path's functions **by signature**, both migrations included) and **sign-in fails closed** (generic error with a reference). No new app setting on Vercel. Self-hosted: the `front` proxy is new (the app's port is no longer published), and `JADARAT_CLIENT_IP_HEADER` is now required (§7). |
| A person is locked out | Browsers they chose to remember still sign in; the lock ends after 15 minutes, at once with **Forgot password?** (that browser can then sign in for 24 hours even under a new pause — 30 days if «تذكّر هذا المتصفح» is ticked), or when the Organization Admin presses «إلغاء إيقاف تسجيل الدخول» on their profile (at most 3 times a day). |
| "Unlocked 3 times in the last 24 hours" | The account is under repeated attack (or the admin session is misused). The owner sets a new password (**Forgot password?**); check `auth.lockout` for the account's `subject_ref` and the audit trail (`platform.user.sign_in_unlocked`). |
| Worker logs `organization_hourly_cap` | More than 50 lockout e-mails in an hour in one organization: a spray against it. Locks still apply; check the alert queries (§8) and the client references. |
| `auth.limiter.unavailable` with `fail_closed` | Sign-in is down. Check `/api/health/ready`, that both migrations are applied, and `DATABASE_URL_APP_SERVER`. |
| A whole office is refused | 100 wrong passwords (or 1,000 attempts) from one address in 15 minutes. Raise `PLATFORM_AUTH_LIMITS.signIn` or, later, register the office range (§7). |
| Key rotation | `select private.rotate_rate_limit_keys();` as the migration role (§2). |
| Table sizes | `select bucket, count(*) from private.rate_limit_counters group by 1; select count(*) from private.sign_in_trusted_devices;` |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | **Smoke test only** (`compose.smoke.yaml`, 45 s): refused in production without `AUTH_RATE_LIMIT_WINDOW_SMOKE_ONLY=1`, and on Vercel production always. |

## 11. Known limits and follow-ups

1. **Session refresh** in the request proxy is not limited per client yet (TM-0003 T-IAM-31).
2. **Per-person lockout cap per organization**: the worker counts the person's e-mails in the organization it writes in (the request's account resolves to one organization — the most recently used); a person active in two organizations could, rarely, get one a day from each.
3. **RR-IAM-01** (§9): review at the production Supabase plan decision.
4. **Proof-of-work challenge** after repeated failures (ADR 0003 §2, TM-0001 F-05).
5. **Platform security-event store** (TM-0003 F-IAM-06); alert rules in the collector (ADR 0009 §5).
6. **Trusted office ranges** per organization (§7); **host → tenant resolution** (ADR 0002 §4), so an organization's lockout policy applies on its own host (§6).
7. **Membership lookup cost**: `sign_in_account_in_tenant` compares the address through `private.auth_user_email` (not using Auth's partial e-mail index); fine at R1 sizes, revisit with large organizations.
