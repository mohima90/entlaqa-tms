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
set -a && . .secrets/.env && set +a
CA_PEM="$(cat .secrets/ca.crt)"
enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
MIGRATION_URL="postgresql://postgres:$(enc "$POSTGRES_PASSWORD")@localhost:55432/postgres"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "smoke: building the app (standalone, no environment baked in)"
  (cd "$ROOT" && pnpm --filter @jadarat/suite build >/dev/null)
fi

echo "smoke: starting PostgreSQL, Auth and the TLS gateway"
compose up -d --wait db
compose up -d auth gateway
for i in $(seq 1 60); do
  curl -sf --cacert .secrets/ca.crt https://localhost:8443/auth/v1/health >/dev/null && break
  [[ $i -eq 60 ]] && { echo "smoke: Auth did not become healthy" >&2; exit 1; }
  sleep 2
done

echo "smoke: deploying migrations (scripts/db-deploy.sh, TLS verify-full)"
(cd "$ROOT" && DATABASE_URL="$MIGRATION_URL" DATABASE_CA_CERT="$CA_PEM" bash scripts/db-deploy.sh apply)

echo "smoke: starting the app container"
compose up -d --build --wait app

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
