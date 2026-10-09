# Self-hosted (sovereign) stack — `infra/docker`

> Backlog: **T-M1-D04** (walking skeleton on the self-hosted stack) · ADR 0010 §3a/§4 · CI: **gate 15** (`selfhosted` job)

The whole product running on servers we (or the customer) control, with no Vercel and no Supabase cloud:

| Container | Image (pinned by digest in `compose.yaml`) | Role |
|---|---|---|
| `db` | `supabase/postgres:17.11.0.003` | PostgreSQL 17.11 (same version as the cloud), TLS on |
| `auth` | `supabase/gotrue:v2.197.0` | Supabase Auth: password sign-in, ES256 keys, TOTP MFA, Custom Access Token hook, invitation-only sign-up hook (before user created), recovery tokens. **Sends no e-mail** (no mail relay; T-M2-17) |
| `gateway` | `nginxinc/nginx-unprivileged:stable-alpine-slim` | TLS in front of Auth, Supabase URL layout (`/auth/v1/…`); refuses Auth's public token-by-e-mail endpoints (`/recover`, `/otp`, `/magiclink`, `/resend`) |
| `app` | `jadarat/suite:local` (`app.Dockerfile`, distroless Node 24, non-root) | The web app (standalone build) |
| `worker` ×2 | `jadarat/worker:local` (`worker.Dockerfile`, distroless Node 24, non-root) | Background jobs and domain events (ADR 0004/0005; runbook `docs/engineering/background-jobs.md`), **every e-mail** over SMTP — invitations, password reset and "password changed" (ADR 0008; `docs/engineering/email.md`, `password-reset.md`). The only container with an Auth admin key (password-reset links, T-M2-17) |
| `mailpit` | `axllent/mailpit:v1.29.7` (MIT) | **Stand-in for the installation's mail relay**: keeps every message for inspection and sends nothing on; STARTTLS required. Receives every e-mail (all sent by the worker). A real installation points `SMTP_URL` at its own relay and drops this service |
| `glitchtip` | `glitchtip/glitchtip:6.2.6` (MIT) | In-country error tracker, Sentry-compatible (ADR 0009 §4). All-in-one mode (web + worker, no Valkey); no route out of the installation; UI over TLS through the gateway at `https://localhost:8100`; events kept 90 days |
| `errors-db` | `postgres:17.11` | GlitchTip's own database: error data never shares the TMS database |

**Required setting for production:** `JADARAT_CLIENT_IP_HEADER` on the app = the client-IP header your load balancer or reverse proxy **overwrites** (e.g. `X-Real-IP`, never `X-Forwarded-For`). Without it every visitor shares one rate-limit budget (password reset, error reports) and one abuser can exhaust it for all (`docs/engineering/password-reset.md` §5). This stack publishes the app directly and leaves it empty.

**Network and TLS.** The database accepts network connections **only over TLS** (`db/pg_hba.conf`), and its clients verify it against the installation's own CA (app → db, Auth → db, migrations); the app verifies the gateway the same way. There are two plain-HTTP hops inside the installation:
- **gateway → Auth.** Supabase Auth has no TLS listener. The hop runs on an internal network that only those two containers join, and Auth has no route anywhere except the database and the gateway.
- **app / gateway → GlitchTip.** Error reports, already scrubbed, go over the internal `errors` network. GlitchTip reaches its own database only over another internal network, and has **no route out of the installation**: no uptime calls, webhooks or social sign-in can send data abroad. The gateway serves its UI over TLS.

- **worker → mail relay.** SMTP with STARTTLS required and verified: here against a separate mail CA that may vouch for `mailpit` only (`gen-secrets.sh`, `SMTP_CA_CERT_FILE`); for a real relay, its own CA. Mailpit sits on an internal network with the workers alone.
- **worker / admin-cli → gateway (Auth admin API).** TLS, verified against the installation's CA, on the gateway's **admin port 8444**, which is not published and answers by source network (T-M2-17 security review): the internal `auth-admin` network (the workers, `10.231.0.0/28`: the gateway and up to about 12 workers) gets only `POST /auth/v1/admin/generate_link` — password-reset links (that call can also ask Auth for sign-up or magic-link links, but every user creation still passes the sign-up hook, which admits only a valid invitation), with the worker's service_role token (`WORKER_AUTH_ADMIN_TOKEN` in `.secrets/.env`, passed as `SUPABASE_SECRET_KEY`); the internal `auth-tools` network (the operators' one-off `admin-cli`, `10.231.0.16/28`) gets only `POST /auth/v1/admin/users` — creating a confirmed user. Everything else on that port, and every other source (the app, the host), is refused. The published port 8443 serves **no** admin path (`/auth/v1/admin/…`, `/auth/v1/invite`), whatever the key. The two subnets are fixed in `compose.yaml` and `gateway/nginx.conf`: if one collides with a network of the host, change both files together.

The app reaches Auth only through the gateway. Host ports are bound to `127.0.0.1` only.

**Hardening.** No container can gain privileges (`no-new-privileges`). App, workers, Mailpit, gateway, Auth and GlitchTip drop all Linux capabilities and run with a read-only filesystem. GlitchTip's database keeps only the capabilities PostgreSQL's start-up needs. Every container restarts automatically; every container except the workers has a health check (a stuck worker shows as events waiting in the outbox — runbook §5; alerts are a follow-up). GlitchTip runs without its Django admin, API browser or uptime monitoring, and with its own PII scrubber on as a second line of defence. The database receives the Auth password only as a SCRAM verifier, so it never appears in its logs; each container mounts only the certificate files it needs.

## One command

```bash
bash infra/docker/smoke.sh        # KEEP=1 keeps the stack running · SKIP_BUILD=1 reuses the app build
```

It generates secrets, builds the app (no environment baked in), starts the stack, applies the migrations with the **production deploy script** (`scripts/db-deploy.sh`, verify-full TLS), creates a user through the operators' `admin-cli`, provisions an organization with `scripts/provision-tenant.sh`, signs in through a real browser (`apps/suite/e2e/signed-in.spec.ts`), runs the Auth parity checks (`check-auth-parity.mjs`), and verifies the audit trail, session revocation and TLS. It runs the background-job workers and an e-mail through Mailpit, then the invitation journey (T-M2-07) in Arabic and English: an Organization Admin invites, resends and revokes (`e2e/invitations.spec.ts`); the worker e-mails the invitation (link built from `APP_BASE_URL`); the smoke test reads the accept link from Mailpit's API and the invitee sets a password and lands signed in (`e2e/invite-accept.spec.ts`), with the used, expired and revoked link states. The database is then checked: account, membership and roles, audit events, a sent delivery without content, no token in any log. The password journeys follow: a My profile change and a password reset (`e2e/profile.spec.ts`, `e2e/password-reset.spec.ts`) with the app on `PASSWORD_RESET_DELIVERY=worker` — the reset link is read from **our** e-mail (worker, organization's name, Arabic first, HTML and text), each change brings exactly one "password changed" notice (ours; Auth's is off), every request is answered, the worker's `generate_link` for an unknown address answers 404 and creates no user, the worker gets no other admin call (listing, creating, changing or deleting users, invitations), the published port refuses every admin path even with a valid admin key, the admin port is not published and refuses the app and the host, and Auth's public token-by-e-mail endpoints are refused at the gateway. It then sets up GlitchTip (`glitchtip/bootstrap.py`) and sends one browser error (through the app's tunnel) and one server error (signing in while Auth is down, `e2e/auth-outage.spec.ts`). Both must arrive in GlitchTip with their messages redacted and none of the planted personal data. CI runs exactly this on every PR (gate 15) and scans the app image (no fixable HIGH/CRITICAL allowed).

## Manual operation

```bash
cd infra/docker
./gen-secrets.sh                                          # .secrets/: CA, TLS certs, ES256 JWK, .env (passwords, Auth admin key)
docker compose --env-file .secrets/.env up -d db auth gateway
# migrations (from the repo root):
DATABASE_URL="postgresql://postgres:<POSTGRES_PASSWORD>@localhost:55432/postgres" \
  DATABASE_CA_CERT="$(cat infra/docker/.secrets/ca.crt)" bash scripts/db-deploy.sh apply
pnpm --filter @jadarat/suite build && docker compose --env-file .secrets/.env up -d --build app
# a confirmed Auth user, through the admin-cli tool (create-user.mjs on the internal auth-tools network;
# run as the owner of .secrets, which holds the signing key it reads); prints the user id:
NEW_USER_PASSWORD='…' docker compose --env-file .secrets/.env run --rm --user "$(id -u):$(id -g)" \
  -e NEW_USER_PASSWORD admin-cli admin@example.org
# then scripts/provision-tenant.sh apply with ADMIN_USER_ID=<that id>; open http://localhost:3200/ar/sign-in
```

**Error tracking (GlitchTip, once per installation).** Start `errors-db glitchtip`. Then create the operator account, the organization and the project, and get the app's DSN:

```bash
GLITCHTIP_ADMIN_PASSWORD="$(sed -n 's/^GLITCHTIP_ADMIN_PASSWORD=//p' .secrets/.env)" \
  docker compose --env-file .secrets/.env exec -T -e GLITCHTIP_ADMIN_EMAIL=ops@customer.example \
  -e GLITCHTIP_ADMIN_PASSWORD glitchtip python manage.py shell <glitchtip/bootstrap.py   # prints DSN=…
```

Then:
1. Add `SENTRY_DSN=<that DSN>` to `.secrets/.env` and restart the app (`up -d app`).
2. Operators sign in at `https://localhost:8100` with that account. The gateway serves it over TLS with the installation's CA. Registration and organization creation are off.
3. For a real host name:
   - set `GLITCHTIP_DOMAIN` (e.g. `https://errors.customer.example:8100`) and `GLITCHTIP_EXTRA_HOSTS` (e.g. `errors.customer.example`) in `.secrets/.env`; the internal names stay allowed;
   - give the gateway a certificate for that name from the customer's PKI. The generated CA is name-constrained to the stack's own hosts and cannot sign one.
   
   Connect the customer's SSO before go-live.

**Upgrading an existing installation.** Re-run `./gen-secrets.sh` after pulling a new version. It keeps every existing secret and appends the ones the new version needs (e.g. GlitchTip's, the worker's Auth admin token). Without them, every `docker compose` command stops with "run with --env-file".

**E-mail: one sender, the worker (T-M2-17, BRD v2.5 FR-NTF-02).** Every e-mail — invitations, password reset, "password changed" — is sent by the worker through the notification service, in the organization's language and name, to the relay in `SMTP_URL`. Auth has **no mail relay** (no `GOTRUE_SMTP_HOST`: its mailer is a no-op), no templates, and its own "password changed" notice is off; the app runs with `PASSWORD_RESET_DELIVERY=worker` and only queues requests in the database. The worker creates reset links through Auth's admin API with `WORKER_AUTH_ADMIN_TOKEN` (next paragraph). Runbook: `docs/engineering/password-reset.md` §5.

**Auth admin key (T-M2-17 security review).** `WORKER_AUTH_ADMIN_TOKEN` is a service_role token signed with the installation's ES256 key, **valid 90 days**, held by the workers only and usable only for `generate_link` (admin port 8444, network `auth-admin`).
- **Renew** (every 90 days at the latest): run `./gen-secrets.sh`, then `docker compose --env-file .secrets/.env up -d worker`. The script replaces the token once fewer than 30 days are left (it says so), and also a token signed with another key or an earlier build's one-year token; otherwise it keeps it. From 30 days before expiry, each worker logs a warning at start-up and then once a day while it runs (reason `auth_admin_key_expiry`, state `expiring`, then `expired`; the days left only, never the token). Put the renewal in the installation's maintenance calendar. An expired token shows as `AUTH_ADMIN_KEY` in the worker log: reset requests are retried and expire unanswered after 60 minutes.
- **Revoke at once** (token or `.secrets/` exposed): rotate the signing key — delete `.secrets/jwt-private.jwk.json` and the `JWT_KEYS=` line in `.secrets/.env`, run `./gen-secrets.sh` (a new key, its `JWT_KEYS` and a new worker token), then `docker compose --env-file .secrets/.env up -d auth app worker`. Every token signed with the old key stops working, including signed-in users' access tokens (people may have to sign in again). `gen-secrets.sh` refuses to run while `JWT_KEYS` and the key file disagree.
- `admin-cli` signs its own 60-second token per run; it holds no stored key.

**Sign-ups and invitations (T-M2-07, FR-IAM-03).** Auth accepts sign-ups (`GOTRUE_DISABLE_SIGNUP: 'false'`) so that an invited person can create their own account from the invitation link; the app calls the public `/auth/v1/signup` endpoint and holds **no Auth admin key**. Every new account passes Auth's *before user created* hook (`private.before_user_created_hook`, `GOTRUE_HOOK_BEFORE_USER_CREATED_*`), which refuses everything except an e-mail sign-up carrying a valid invitation token for that e-mail. Anonymous and phone sign-ups are off. Never turn sign-ups on without the hook: the hook is the only gate. Operators still create the first administrators with `admin-cli` (`create-user.mjs`; Auth's admin API does not run the hook). The smoke test checks that a sign-up without an invitation, or with another person's invitation, is refused and that no container but the worker has an Auth admin key. An installation set up from an earlier development build may still have `SUPABASE_SECRET_KEY` in `.secrets/.env`: `gen-secrets.sh` removes it; the token stays valid until its expiry unless the ES256 signing key (`JWT_KEYS`) is rotated.

`.secrets/` is git-ignored and created with mode 0700 (private keys 0600; when not run as root, the gateway key is 0644 so nginx's unprivileged user can read it — run `gen-secrets.sh` as root on a real server).

**Changing the Auth database password.** `db/99-roles.sql` runs only when the database volume is first created. To change it later: generate a new password, compute its verifier (`node --input-type=module -e "import { scramSha256Verifier } from './scripts/lib/scram.mjs'; console.log(scramSha256Verifier(process.argv[1]))" <new>` from the repo root, on the server), run `alter role supabase_auth_admin password '<verifier>'` as `postgres`, update both values in `.secrets/.env` and `docker compose … up -d auth`. For a real installation, replace the generated CA and certificates with the customer's PKI and keep the files in their secret manager (ADR 0010 §5); the app reads the database CA from a file (`DATABASE_CA_CERT_FILE`).

## What this proved (spike report, 4 Oct 2026)

ADR 0010 §3a pass/fail list, on the versions pinned above:

| Capability | Result | Evidence |
|---|---|---|
| Custom Access Token hook incl. `session_id` in the hook input | ✅ **Pass** | Browser sign-in reaches `/suite` with the organization name — only possible with `tenant_id` in the token and `session_context` accepted by `private.current_tenant_id()` |
| Asymmetric JWT signing keys (JWKS, `kid`) | ✅ **Pass** | ES256 token; `kid` published at `/auth/v1/.well-known/jwks.json`; signature verified locally (`check-auth-parity.mjs`). Key **rotation with overlap**: not yet exercised (follow-up) |
| TOTP MFA + `aal` claim | ✅ **Pass** | Enrol → challenge → verify gives `aal2` with `totp` in `amr` |
| New API keys (publishable/secret) | ➖ Not applicable | Self-hosted Auth has no API-key gateway; admin calls use a 60-s `service_role` token signed with the installation's key (`create-user.mjs`). The app's "publishable key" setting is a placeholder here |
| Migrations as on hosted Supabase | ✅ **Pass** | `db-deploy.sh apply` + `verify-deployment.sql` clean as the image's `postgres` role |
| Sign-out revokes the session; audit events written | ✅ **Pass** | `auth.sessions` empty for the user; `platform.auth.signed_in`/`signed_out` rows |
| TLS on every network hop that leaves a private network, verified | ✅ **Pass** | All PostgreSQL network connections over TLS (`pg_stat_ssl`) and a non-TLS connection is refused; Auth uses `sslmode=verify-full`; the app verifies the gateway via `NODE_EXTRA_CA_CERTS`. Gateway → Auth is plain HTTP on an isolated internal network (the app cannot reach Auth directly — checked) |
| One image, configured at runtime | ✅ **Pass** (after a fix) | Supabase settings were inlined at build time; now read at runtime (`readSupabasePublicConfigFromEnv`), so the same image serves every deployment |
| Password/MFA verification-attempt hooks (lockout) | ⏳ Not yet tested | With the sign-in rate-limit work (R-34, F-IAM-01) in M2 |
| Leaked-password check, SAML, Realtime, Storage, Supavisor | ⏳ Not in this stack yet | Added when the features that need them are built (M2+, R2) |

Independent review fixes (4 Oct 2026): Auth password no longer reaches the database in clear (it was visible in the DDL log — the smoke test now checks the logs), TLS required by `pg_hba.conf`, isolated networks, per-file certificate mounts, name-constrained CA, private keys 0600, container hardening and health checks, no blanket secret export in `smoke.sh`.

Findings fixed in this spike: build-time inlining of the Supabase settings (above); database CA can now come from a mounted file; the app image moved to distroless Debian 13 (the `-slim` image carried fixable HIGH CVEs in its bundled npm and OpenSSL). Third-party images (Postgres, Auth, gateway) are scanned and **reported** in CI; keeping them patched in customer installations is tracked as risk R-56.
