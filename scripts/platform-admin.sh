#!/usr/bin/env bash
# Grants (or revokes) the Platform Super Admin role of an existing Auth user, by UID (FR-ADM-17; runbook:
# docs/engineering/platform-console.md). Normally run by the "Platform admin" workflow.
#
#   DATABASE_URL=… DATABASE_CA_CERT=… ADMIN_USER_ID=… [ADMIN_ACTION=grant|revoke|list] \
#     bash scripts/platform-admin.sh plan|apply
#
# plan runs everything in a transaction that is always rolled back; apply commits it. Same connection rules
# as scripts/provision-tenant.sh (migration role, verify-full TLS, nothing secret on a command line, the
# deploy lock). ADMIN_USER_ID is the user's UID, never an e-mail: no personal data in inputs or logs.
# `list` prints the Super Admins' UIDs and grant times only (no ADMIN_USER_ID needed). In GitHub Actions the
# run id and the login that ran it (GITHUB_RUN_ID, GITHUB_ACTOR) go into the audit row (review L5).
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "plan" && "$MODE" != "apply" ]]; then
  echo "usage: DATABASE_URL=… DATABASE_CA_CERT=… ADMIN_USER_ID=… [ADMIN_ACTION=grant|revoke|list] bash scripts/platform-admin.sh plan|apply" >&2
  exit 2
fi

ADMIN_ACTION="${ADMIN_ACTION:-grant}"
ADMIN_USER_ID="$(printf '%s' "${ADMIN_USER_ID:-}" | tr '[:upper:]' '[:lower:]')"

fail() { echo "platform-admin: $1" >&2; exit 1; }
[[ "$ADMIN_ACTION" == "grant" || "$ADMIN_ACTION" == "revoke" || "$ADMIN_ACTION" == "list" ]] ||
  fail "ADMIN_ACTION must be grant, revoke or list"
if [[ "$ADMIN_ACTION" == "list" ]]; then
  ADMIN_USER_ID=""
else
  [[ "$ADMIN_USER_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
    fail "ADMIN_USER_ID must be the user's UID (Supabase: Authentication → Users → Copy UID), never an e-mail"
fi
# Recorded in the audit row (Actions sets both; empty elsewhere). Validated here and again in the database.
RUN_ID="${GITHUB_RUN_ID:-}"
RUN_ACTOR="${GITHUB_ACTOR:-}"
[[ -z "$RUN_ID" || "$RUN_ID" =~ ^[0-9]{1,20}$ ]] || fail "GITHUB_RUN_ID must be digits"
[[ -z "$RUN_ACTOR" || "$RUN_ACTOR" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$ ]] || fail "GITHUB_ACTOR must be a GitHub login"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$ROOT" != *"'"* ]] || fail "the repository path must not contain a single quote"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

# shellcheck source=lib/db-connect.sh
source "$ROOT/scripts/lib/db-connect.sh"
db_connect "$WORK" platform-admin
export PGAPPNAME="jadarat-platform-admin"
# Never next to a deploy or worker pass (lib/db-connect.sh § Deploy lock): the console's functions must be
# deployed before they are granted.
trap 'db_unlock; rm -rf "$WORK"' EXIT
db_lock platform-admin exclusive "${DB_DEPLOY_LOCK_WAIT_SECONDS:-960}"

if [[ "$MODE" == "apply" ]]; then END=commit; else END=rollback; fi
{
  echo "begin; set local lock_timeout = '10s'; set local statement_timeout = '1min';"
  echo "set local client_min_messages = notice;"
  printf "\\\\i '%s'\n" "$ROOT/scripts/sql/platform-admin.sql"
  echo "$END;"
} >"$WORK/platform-admin.sql"

# An unknown UID fails in the database with a clear message (SQLSTATE JP004): "no Auth user with this UID".
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -o /dev/null \
  -v admin_user_id="$ADMIN_USER_ID" -v admin_action="$ADMIN_ACTION" \
  -v run_id="$RUN_ID" -v run_actor="$RUN_ACTOR" \
  -f "$WORK/platform-admin.sql"

if [[ "$MODE" == "apply" ]]; then
  echo "platform-admin: apply OK ($ADMIN_ACTION)"
else
  echo "platform-admin: dry run OK ($ADMIN_ACTION; rolled back, nothing changed) — run again with apply"
fi
