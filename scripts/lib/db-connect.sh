# shellcheck shell=bash
# Sourced by scripts/db-deploy.sh, scripts/provision-tenant.sh and scripts/run-outside-deploy.sh
# (docs/engineering/db-deploy.md).
# db_connect <private work dir> <log prefix>: turns DATABASE_URL into libpq variables + a pgpass file
# (scripts/pg-connection.mjs; nothing secret on any command line or in error output) and sets up TLS:
# always verify-full against DATABASE_CA_CERT; only a local server (127.0.0.1/localhost) may set
# DB_DEPLOY_LOCAL_NO_TLS=1. Unsets DATABASE_URL and PGPASSWORD afterwards.
db_connect() {
  local work="$1" prefix="$2" key value
  node "$ROOT/scripts/pg-connection.mjs" "$work/pgpass" "$work/conn.env"
  while IFS='=' read -r key value; do
    case "$key" in
      PGHOST | PGPORT | PGUSER | PGDATABASE | DB_IS_LOCAL) export "$key=$value" ;;
      '') ;;
      *) echo "$prefix: unexpected connection key" >&2; return 1 ;;
    esac
  done <"$work/conn.env"
  export PGPASSFILE="$work/pgpass"
  unset DATABASE_URL PGPASSWORD

  if [[ "${DB_DEPLOY_LOCAL_NO_TLS:-0}" == "1" && "$DB_IS_LOCAL" == "1" ]]; then
    export PGSSLMODE=disable
  else
    if [[ "${DATABASE_CA_CERT:-}" != *"-----BEGIN CERTIFICATE-----"* ]]; then
      echo "$prefix: DATABASE_CA_CERT (PEM of the server's root CA) is required: TLS is verify-full" >&2
      return 1
    fi
    printf '%s\n' "$DATABASE_CA_CERT" >"$work/ca.crt"
    export PGSSLMODE=verify-full PGSSLROOTCERT="$work/ca.crt"
  fi
  export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
}

# Deploy lock (T-M2-38 security reviews; docs/engineering/db-deploy.md § Deploy lock). Every run that
# changes the database — scripts/db-deploy.sh (plan and apply) and scripts/provision-tenant.sh — holds
# the session-level advisory lock with the fixed two-part key (20261015, 1) EXCLUSIVELY for its whole run,
# in a connection of its own (application_name jadarat-deploy-lock), so the manual and the automatic
# workflows never overlap, whatever GitHub's concurrency groups do. The GitHub Actions worker pass
# (scripts/run-outside-deploy.sh) holds the same key SHARED: a deploy waits for a running pass, and a pass
# waits for a running deploy. Advisory locks belong to one database: every holder must connect to the
# same database (hosted Supabase: `/postgres`) through a SESSION connection (direct or session pooler,
# port 5432 — never the transaction pooler, port 6543, which is refused). db_unlock releases the lock
# explicitly before it ends the session; the lock also ends with the server session (script exit,
# cancelled job, lost runner). Do not reuse the key for anything else.
DB_DEPLOY_LOCK_KEY='20261015, 1'

# db_lock <log prefix> exclusive|shared <wait seconds ≥ 1>: waits up to <wait seconds> for the lock.
# Needs the libpq variables of db_connect. Returns 0 when held (release: db_unlock, also on exit), 1 when
# the wait ran out or anything failed.
db_lock() {
  local prefix="$1" mode="$2" wait="${3:-}" try take sql line out
  if [[ ! "$wait" =~ ^[0-9]+$ ]] || ((wait < 1)); then
    echo "$prefix: the deploy lock wait must be a whole number of seconds (at least 1)" >&2
    return 1
  fi
  case "$mode" in
    exclusive) try=pg_try_advisory_lock take=pg_advisory_lock ;;
    shared) try=pg_try_advisory_lock_shared take=pg_advisory_lock_shared ;;
    *)
      echo "$prefix: unknown deploy lock mode" >&2
      return 1
      ;;
  esac
  if [[ "${PGPORT:-5432}" == "6543" ]]; then
    echo "$prefix: port 6543 is Supabase's transaction pooler, which cannot hold the deploy lock — use the session pooler (port 5432)" >&2
    return 1
  fi
  sql="select pg_catalog.$try($DB_DEPLOY_LOCK_KEY) as got \\gset
\\if :got
\\else
\\echo waiting
set lock_timeout = '${wait}s';
select pg_catalog.$take($DB_DEPLOY_LOCK_KEY);
\\endif
\\echo locked"
  # The holder: one psql session that reads its commands from this shell and stays connected (idle)
  # until db_unlock. Query results go nowhere; \echo lines report the state.
  coproc DB_LOCK {
    PGAPPNAME=jadarat-deploy-lock exec psql -X -q -At --no-psqlrc -v ON_ERROR_STOP=1 -o /dev/null
  }
  # Kept apart: bash unsets DB_LOCK when the holder exits (e.g. on a lock timeout).
  DB_LOCK_HOLDER_PID="$DB_LOCK_PID"
  DB_LOCK_HOLDER_IN="${DB_LOCK[1]}"
  DB_LOCK_HOLDER_OUT="${DB_LOCK[0]}"
  out="$DB_LOCK_HOLDER_OUT"
  printf '%s\n' "set statement_timeout = 0; set idle_session_timeout = 0;" "$sql" >&"$DB_LOCK_HOLDER_IN"
  while IFS= read -r -t "$((wait + 60))" line <&"$out" 2>/dev/null; do
    case "$line" in
      waiting) echo "$prefix: the deploy lock is held by another deploy, provisioning run or worker pass — waiting up to ${wait}s" ;;
      locked) return 0 ;;
    esac
  done
  db_unlock
  echo "$prefix: could not take the deploy lock (held by another run for more than ${wait}s, or the connection failed — see above)" >&2
  return 1
}

# db_unlock: releases the lock explicitly (pg_advisory_unlock_all — a pooler may keep the server session
# open after the client leaves), ends the holder's session, waits up to 5 s for it and only then kills it.
# Safe to call more than once, or without a lock.
db_unlock() {
  local fd="${DB_LOCK_HOLDER_IN:-}" out="${DB_LOCK_HOLDER_OUT:-}" pid="${DB_LOCK_HOLDER_PID:-}" line=""
  DB_LOCK_HOLDER_IN="" DB_LOCK_HOLDER_OUT="" DB_LOCK_HOLDER_PID=""
  # Only while our end of its input is still open (a failed `exec` redirection would end this shell); the
  # write runs in a subshell, so a holder that is already gone cannot end this shell with SIGPIPE.
  if [[ -n "$fd" ]] && { true >&"$fd"; } 2>/dev/null; then
    (printf '%s\n' 'select pg_catalog.pg_advisory_unlock_all();' '\echo released' '\q' >&"$fd") 2>/dev/null || true
    exec {fd}>&-
    if [[ -n "$out" ]]; then IFS= read -r -t 5 line <&"$out" 2>/dev/null || true; fi
  fi
  if [[ -n "$pid" ]]; then
    for _ in {1..50}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}
