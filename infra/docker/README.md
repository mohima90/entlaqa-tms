# Self-hosted (sovereign) stack — `infra/docker`

> Backlog: **T-M1-D04** (walking skeleton on the self-hosted stack) · ADR 0010 §3a/§4 · CI: **gate 15** (`selfhosted` job)

The whole product running on servers we (or the customer) control, with no Vercel and no Supabase cloud:

| Container | Image (pinned by digest in `compose.yaml`) | Role |
|---|---|---|
| `db` | `supabase/postgres:17.11.0.003` | PostgreSQL 17.11 (same version as the cloud), TLS on |
| `auth` | `supabase/gotrue:v2.197.0` | Supabase Auth: password sign-in, ES256 keys, TOTP MFA, Custom Access Token hook |
| `gateway` | `nginxinc/nginx-unprivileged:stable-alpine-slim` | TLS in front of Auth, Supabase URL layout (`/auth/v1/…`) |
| `app` | `jadarat/suite:local` (`app.Dockerfile`, distroless Node 24, non-root) | The web app (standalone build) |
| `glitchtip` | `glitchtip/glitchtip:6.2.6` (MIT) | In-country error tracker, Sentry-compatible (ADR 0009 §4). All-in-one mode (web + worker, no Valkey); no route out of the installation; UI over TLS through the gateway at `https://localhost:8100`; events kept 90 days |
| `errors-db` | `postgres:17` | GlitchTip's own database: error data never shares the TMS database |

**Network and TLS.** The database accepts network connections **only over TLS** (`db/pg_hba.conf`), and its clients verify it against the installation's own CA (app → db, Auth → db, migrations); the app verifies the gateway the same way. There are two plain-HTTP hops inside the installation:
- **gateway → Auth.** Supabase Auth has no TLS listener. The hop runs on an internal network that only those two containers join, and Auth has no route anywhere except the database and the gateway.
- **app / gateway → GlitchTip.** Error reports, already scrubbed, go over the internal `errors` network. GlitchTip reaches its own database only over another internal network, and has **no route out of the installation**: no uptime calls, webhooks or social sign-in can send data abroad. The gateway serves its UI over TLS.

The app reaches Auth only through the gateway. Host ports are bound to `127.0.0.1` only.

**Hardening.** No container can gain privileges (`no-new-privileges`). App, gateway, Auth and GlitchTip drop all Linux capabilities and run with a read-only filesystem. GlitchTip's database keeps only the capabilities PostgreSQL's start-up needs. Every container restarts automatically and has a health check. GlitchTip runs without its Django admin, API browser or uptime monitoring, and with its own PII scrubber on as a second line of defence. The database receives the Auth password only as a SCRAM verifier, so it never appears in its logs; each container mounts only the certificate files it needs.

## One command

```bash
bash infra/docker/smoke.sh        # KEEP=1 keeps the stack running · SKIP_BUILD=1 reuses the app build
```

It generates secrets, builds the app (no environment baked in), starts the stack, applies the migrations with the **production deploy script** (`scripts/db-deploy.sh`, verify-full TLS), creates a user through the Auth admin API, provisions an organization with `scripts/provision-tenant.sh`, signs in through a real browser (`apps/suite/e2e/signed-in.spec.ts`), runs the Auth parity checks (`check-auth-parity.mjs`), and verifies the audit trail, session revocation and TLS. It then sets up GlitchTip (`glitchtip/bootstrap.py`) and sends one browser error (through the app's tunnel) and one server error (signing in while Auth is down, `e2e/auth-outage.spec.ts`). Both must arrive in GlitchTip with their messages redacted and none of the planted personal data. CI runs exactly this on every PR (gate 15) and scans the app image (no fixable HIGH/CRITICAL allowed).

## Manual operation

```bash
cd infra/docker
./gen-secrets.sh                                          # .secrets/: CA, TLS certs, ES256 JWK, .env (passwords)
docker compose --env-file .secrets/.env up -d db auth gateway
# migrations (from the repo root):
DATABASE_URL="postgresql://postgres:<POSTGRES_PASSWORD>@localhost:55432/postgres" \
  DATABASE_CA_CERT="$(cat infra/docker/.secrets/ca.crt)" bash scripts/db-deploy.sh apply
pnpm --filter @jadarat/suite build && docker compose --env-file .secrets/.env up -d --build app
NEW_USER_PASSWORD='…' node create-user.mjs admin@example.org      # prints the user id
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
3. For a real host name, set `GLITCHTIP_DOMAIN` (e.g. `https://errors.customer.example:8100`) and `GLITCHTIP_ALLOWED_HOSTS` in `.secrets/.env`. Connect the customer's SSO before go-live.

**Upgrading an existing installation.** Re-run `./gen-secrets.sh` after pulling a new version. It keeps every existing secret and appends the ones the new version needs (e.g. GlitchTip's). Without them, every `docker compose` command stops with "run with --env-file".

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
