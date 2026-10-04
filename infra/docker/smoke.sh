#!/usr/bin/env bash
# Self-hosted (sovereign) smoke test, T-M1-D04: brings up the whole stack from this directory, deploys the
# migrations with the production deploy script, creates a user and an organization, signs in through a
# real browser against the app container, checks the audit trail and TLS, then tears everything down.
#
#   bash infra/docker/smoke.sh            # KEEP=1 leaves the stack running; SKIP_BUILD=1 reuses the build
#
# Needs: Docker with compose, Node + pnpm (repo installed), psql, Playwright Chromium.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/infra/docker"
DOCKER="${DOCKER:-docker}"
compose() { $DOCKER compose --env-file .secrets/.env "$@"; }

cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then compose logs --tail 40 >&2 || true; fi
  if [[ "${KEEP:-0}" != "1" ]]; then compose down -v >/dev/null 2>&1 || true; fi
  if [[ $status -eq 0 ]]; then echo "smoke: PASSED"; else echo "smoke: FAILED (exit $status)" >&2; fi
}
trap cleanup EXIT

./gen-secrets.sh
# Only the values this script needs, read one by one (never the whole file into the environment, so the
# Auth password and the signing key are not handed to every child process). Passwords are alphanumeric.
secret() { sed -n "s/^$1=//p" "$ROOT/infra/docker/.secrets/.env"; }
POSTGRES_PASSWORD="$(secret POSTGRES_PASSWORD)"
CA_PEM="$(cat .secrets/ca.crt)"
MIGRATION_URL="postgresql://postgres:$POSTGRES_PASSWORD@localhost:55432/postgres"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "smoke: building the app (standalone, no environment baked in)"
  (cd "$ROOT" && pnpm --filter @jadarat/suite build >/dev/null)
fi

echo "smoke: starting PostgreSQL, Auth and the TLS gateway"
compose up -d --wait db auth gateway
curl -sf --cacert .secrets/ca.crt https://localhost:8443/auth/v1/health >/dev/null ||
  { echo "smoke: Auth is not reachable through the TLS gateway" >&2; exit 1; }

echo "smoke: deploying migrations (scripts/db-deploy.sh, TLS verify-full)"
(cd "$ROOT" && DATABASE_URL="$MIGRATION_URL" DATABASE_CA_CERT="$CA_PEM" \
  APP_SERVER_DB_PASSWORD="$(secret APP_SERVER_DB_PASSWORD)" APP_WORKER_DB_PASSWORD="$(secret APP_WORKER_DB_PASSWORD)" \
  bash scripts/db-deploy.sh apply)

echo "smoke: starting the app container"
compose up -d --build --wait app
curl -sf http://localhost:3200/api/health/live >/dev/null || { echo "smoke: liveness check failed" >&2; exit 1; }
curl -sf http://localhost:3200/api/health/ready >/dev/null ||
  { echo "smoke: readiness check failed (app cannot reach the database)" >&2; exit 1; }

EMAIL="smoke-$(date +%s)@sovereign.example"
PASSWORD="Smoke-$(openssl rand -hex 16)"
USER_ID="$(NEW_USER_PASSWORD="$PASSWORD" node create-user.mjs "$EMAIL")"
(cd "$ROOT" && DATABASE_URL="$MIGRATION_URL" DATABASE_CA_CERT="$CA_PEM" TENANT_SLUG=sovereign-smoke \
  TENANT_NAME_AR='منشأة الاختبار السيادي' TENANT_NAME_EN='Sovereign Smoke' ADMIN_USER_ID="$USER_ID" \
  ADD_TO_EXISTING=false bash scripts/provision-tenant.sh apply >/dev/null)

echo "smoke: signing in through a real browser"
(cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 SIGNED_IN_E2E_EMAIL="$EMAIL" \
  SIGNED_IN_E2E_PASSWORD="$PASSWORD" SIGNED_IN_E2E_ORGANIZATION_EN='Sovereign Smoke' \
  pnpm exec playwright test e2e/signed-in.spec.ts --project=desktop-chromium)

echo "smoke: Auth parity checks (ADR 0010 §3a: ES256/JWKS, session_id, TOTP MFA → aal2)"
PARITY_EMAIL="parity-$(date +%s)@sovereign.example"
PARITY_PASSWORD="Parity-$(openssl rand -hex 16)"
NEW_USER_PASSWORD="$PARITY_PASSWORD" node create-user.mjs "$PARITY_EMAIL" >/dev/null
PARITY_EMAIL="$PARITY_EMAIL" PARITY_PASSWORD="$PARITY_PASSWORD" node check-auth-parity.mjs

echo "smoke: checking the audit trail, revoked sessions and TLS"
q() {
  PGPASSWORD="$POSTGRES_PASSWORD" PGSSLMODE=verify-full PGSSLROOTCERT=.secrets/ca.crt \
    psql -h localhost -p 55432 -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 -c "$1"
}
[[ "$(q "select count(*) from platform.audit_events where action in ('platform.auth.signed_in', 'platform.auth.signed_out')")" == "2" ]] ||
  { echo "smoke: expected one signed_in and one signed_out audit event" >&2; exit 1; }
[[ "$(q "select count(*) from auth.sessions where user_id = '$USER_ID'")" == "0" ]] ||
  { echo "smoke: sign-out must revoke the session" >&2; exit 1; }
[[ "$(q "select count(*) from pg_stat_ssl s join pg_stat_activity a using (pid) where a.client_addr is not null and not s.ssl")" == "0" ]] ||
  { echo "smoke: a network connection to PostgreSQL is not using TLS" >&2; exit 1; }
# Correct password, no TLS: must be refused by pg_hba.conf (not by anything else).
no_tls="$(PGPASSWORD="$POSTGRES_PASSWORD" PGSSLMODE=disable PGCONNECT_TIMEOUT=5 \
  psql -h localhost -p 55432 -U postgres -d postgres -X -At -c 'select 1' 2>&1 || true)"
[[ "$no_tls" == *"pg_hba.conf rejects connection"* ]] ||
  { echo "smoke: PostgreSQL must refuse connections without TLS (got: $no_tls)" >&2; exit 1; }

echo "smoke: checking secrets stay out of the logs and Auth is reachable only through the gateway"
if compose logs db auth 2>&1 | grep -qF "$(secret AUTH_DB_PASSWORD)"; then
  echo "smoke: the Auth database password appears in the container logs" >&2; exit 1
fi
# No personal data in operational logs (ADR 0009 §2, verification 1), after the sign-in journeys: the
# test users' passwords must appear in no container's logs; their e-mail addresses — or any e-mail
# address — must not appear in the app's logs. (Supabase Auth itself records the e-mail of a sign-in in
# its own logs; that is third-party behaviour, covered by the log retention/access rules of ADR 0009.)
all_logs="$(compose logs --no-log-prefix 2>&1)"
app_logs="$(compose logs --no-log-prefix app 2>&1)"
for value in "$PASSWORD" "$PARITY_PASSWORD"; do
  if grep -qF "$value" <<<"$all_logs"; then
    echo "smoke: a test user's password appears in the container logs" >&2; exit 1
  fi
done
for value in "$EMAIL" "$PARITY_EMAIL"; do
  if grep -qF "$value" <<<"$app_logs"; then
    echo "smoke: a test user's e-mail address appears in the app logs" >&2; exit 1
  fi
done
if grep -qE '[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)*\.[[:alpha:]]{2,}' <<<"$app_logs"; then
  echo "smoke: an e-mail address appears in the app logs" >&2; exit 1
fi
reach() {
  compose exec -T app /nodejs/bin/node -e \
    "fetch(process.argv[1]).then(()=>process.exit(0)).catch(()=>process.exit(1))" "$1" >/dev/null 2>&1
}
reach https://gateway:8443/auth/v1/health || { echo "smoke: the app cannot reach the gateway" >&2; exit 1; }
if reach http://auth:9999/health; then
  echo "smoke: the app container can reach Auth directly (it must go through the gateway)" >&2; exit 1
fi
