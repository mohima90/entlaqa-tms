#!/usr/bin/env bash
# Runs a command while holding the deploy lock SHARED (T-M2-38 security reviews; scripts/lib/db-connect.sh
# § Deploy lock) — used for the worker pass of the GitHub Actions "Jobs" workflow:
#
#   DATABASE_URL=<a login of the target database> DATABASE_CA_CERT=… bash scripts/run-outside-deploy.sh <command> [args…]
#
# While a deploy or provisioning run holds the lock (or waits for it, ahead of us), the command waits up to
# DB_DEPLOY_LOCK_WAIT_SECONDS (default 480 — a normal deploy takes a few minutes, and the Jobs job's
# 15-minute limit must still leave room for the pass). If the lock is still taken then, the command does
# NOT run and this script FAILS (a red Jobs run): a deploy that long, or a stuck lock holder, needs a look
# (docs/engineering/db-deploy.md § Deploy lock) — it is never skipped silently. Once the lock is held, the
# command runs (a deploy that starts meanwhile waits for it) and its exit code is returned.
# The connection (any login role: advisory locks need no privilege) must be a session connection to the
# same database as the deploy's; it is used for the lock only. The command gets the caller's environment
# without DATABASE_URL and without the libpq variables set here.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: DATABASE_URL=… DATABASE_CA_CERT=… bash scripts/run-outside-deploy.sh <command> [args…]" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
# shellcheck source=lib/db-connect.sh
source "$ROOT/scripts/lib/db-connect.sh"
trap 'db_unlock; rm -rf "$WORK"' EXIT
db_connect "$WORK" deploy-lock

wait_seconds="${DB_DEPLOY_LOCK_WAIT_SECONDS:-480}"
if ! db_lock deploy-lock shared "$wait_seconds"; then
  message="the deploy lock stayed taken for more than ${wait_seconds}s (or could not be taken): this pass did not run — check for a long or stuck DB deploy or provisioning run (docs/engineering/db-deploy.md § Deploy lock)"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then echo "::error::$message"; else echo "deploy-lock: $message" >&2; fi
  exit 1
fi

status=0
env -u PGHOST -u PGPORT -u PGUSER -u PGDATABASE -u PGPASSFILE -u PGSSLMODE -u PGSSLROOTCERT -u PGOPTIONS \
  -u PGAPPNAME -u DB_IS_LOCAL "$@" || status=$?
exit "$status"
