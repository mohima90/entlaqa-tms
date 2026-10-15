#!/usr/bin/env bash
# Runs a command while holding the deploy lock SHARED (T-M2-38 security review N3; scripts/lib/db-connect.sh
# § Deploy lock) — used for the worker pass of the GitHub Actions "Jobs" workflow:
#
#   DATABASE_URL=<a login of the target database> DATABASE_CA_CERT=… bash scripts/run-outside-deploy.sh <command> [args…]
#
# While a deploy or provisioning run holds the lock, or waits for it, the command is NOT run: a notice is
# printed and the script exits 0 (the next scheduled pass runs it). Otherwise the command runs with the
# lock held shared — a deploy that starts meanwhile waits for it — and its exit code is returned.
# The connection (any login role: advisory locks need no privilege) is used for the lock only; the
# command gets the caller's environment without DATABASE_URL and without the libpq variables set here.
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

status=0
db_lock deploy-lock shared-try || status=$?
if [[ $status -eq 3 ]]; then
  message="a database deploy or provisioning run is running or waiting: this pass is skipped (the next one runs as usual)"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then echo "::notice::$message"; else echo "deploy-lock: $message"; fi
  exit 0
elif [[ $status -ne 0 ]]; then
  exit "$status"
fi

status=0
env -u PGHOST -u PGPORT -u PGUSER -u PGDATABASE -u PGPASSFILE -u PGSSLMODE -u PGSSLROOTCERT -u PGOPTIONS \
  -u PGAPPNAME -u DB_IS_LOCAL "$@" || status=$?
exit "$status"
