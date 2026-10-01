#!/usr/bin/env bash
# Creates an organization (tenant) and gives an existing Auth user an ACTIVE membership in it — the
# first administrator of a new organization (T-M1-D03; runbook: docs/engineering/staging-sign-in.md).
#
#   DATABASE_URL=… DATABASE_CA_CERT=… TENANT_SLUG=… TENANT_NAME_AR=… [TENANT_NAME_EN=…] ADMIN_USER_ID=… \
#     [ADD_TO_EXISTING=true] bash scripts/provision-tenant.sh plan|apply
#
# plan runs everything in a transaction that is always rolled back; apply commits it. Same connection
# rules as scripts/db-deploy.sh (migration role, verify-full TLS, nothing secret on a command line).
# Inputs are validated here AND in scripts/sql/provision-tenant.sql; they reach SQL only as psql
# variables. ADMIN_USER_ID is the user's UID, not an e-mail: no personal data in inputs or logs.
set -euo pipefail
# Character (not byte) lengths and classes for Arabic names.
export LC_ALL=C.UTF-8

MODE="${1:-}"
if [[ "$MODE" != "plan" && "$MODE" != "apply" ]]; then
  echo "usage: DATABASE_URL=… DATABASE_CA_CERT=… TENANT_SLUG=… TENANT_NAME_AR=… ADMIN_USER_ID=… bash scripts/provision-tenant.sh plan|apply" >&2
  exit 2
fi

TENANT_SLUG="${TENANT_SLUG:-}"
TENANT_NAME_AR="${TENANT_NAME_AR:-}"
TENANT_NAME_EN="${TENANT_NAME_EN:-}"
ADD_TO_EXISTING="${ADD_TO_EXISTING:-false}"
ADMIN_USER_ID="$(printf '%s' "${ADMIN_USER_ID:-}" | tr '[:upper:]' '[:lower:]')"

fail() { echo "provision: $1" >&2; exit 1; }
[[ "$TENANT_SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] ||
  fail "TENANT_SLUG must be 1-63 lowercase letters, digits or hyphens (no hyphen at either end)"
[[ "$ADMIN_USER_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
  fail "ADMIN_USER_ID must be the user's UID (Supabase: Authentication → Users → Copy UID)"
for value in "$TENANT_NAME_AR" "$TENANT_NAME_EN"; do
  [[ "$value" != *[[:cntrl:]]* ]] || fail "organization names must not contain control characters"
  ((${#value} <= 200)) || fail "organization names must be at most 200 characters"
done
[[ -n "${TENANT_NAME_AR//[[:space:]]/}" ]] || fail "TENANT_NAME_AR is required"
[[ "$ADD_TO_EXISTING" == "true" || "$ADD_TO_EXISTING" == "false" ]] || fail "ADD_TO_EXISTING must be true or false"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$ROOT" != *"'"* ]] || fail "the repository path must not contain a single quote"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

# shellcheck source=lib/db-connect.sh
source "$ROOT/scripts/lib/db-connect.sh"
db_connect "$WORK" provision
export PGAPPNAME="jadarat-provision-tenant"

if [[ "$MODE" == "apply" ]]; then END=commit; else END=rollback; fi
{
  echo "begin; set local lock_timeout = '10s'; set local statement_timeout = '1min';"
  echo "set local client_min_messages = notice;"
  printf "\\\\i '%s'\n" "$ROOT/scripts/sql/provision-tenant.sql"
  echo "$END;"
} >"$WORK/provision.sql"

psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -o /dev/null \
  -v tenant_slug="$TENANT_SLUG" -v tenant_name_ar="$TENANT_NAME_AR" \
  -v tenant_name_en="$TENANT_NAME_EN" -v admin_user_id="$ADMIN_USER_ID" \
  -v add_to_existing="$ADD_TO_EXISTING" \
  -f "$WORK/provision.sql"

if [[ "$MODE" == "apply" ]]; then
  echo "provision: apply OK"
else
  echo "provision: dry run OK (rolled back, nothing changed) — run again with apply"
fi
