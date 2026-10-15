# Sourced by scripts/db-deploy.sh and scripts/provision-tenant.sh (docs/engineering/db-deploy.md).
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

# Deploy lock (T-M2-38 security review M1; docs/engineering/db-deploy.md § Deploy lock). Every run that
# changes the database — scripts/db-deploy.sh (plan and apply) and scripts/provision-tenant.sh — holds
# the session-level advisory lock with the fixed two-part key (20261015, 1) for its whole run, in a
# connection of its own (application_name jadarat-deploy-lock), so the manual and the automatic workflows
# never overlap, whatever GitHub's concurrency groups do. The GitHub Actions worker pass
# (scripts/run-outside-deploy.sh) holds the same key SHARED: a deploy waits for a running pass, and a pass
# is skipped while a deploy holds or waits for the lock. The lock ends with its connection (script exit,
# cancelled job, lost runner). Do not reuse the key for anything else.
DB_DEPLOY_LOCK_KEY='20261015, 1'

# db_lock <log prefix> exclusive <wait seconds>: waits up to <wait seconds> (≥ 1) for the lock.
# db_lock <log prefix> shared-try: takes it shared without waiting.
# Needs the libpq variables of db_connect. Returns 0 when held (release: db_unlock, or exit), 3 when
# shared-try found it taken or requested, 1 on any other failure.
db_lock() {
  local prefix="$1" mode="$2" wait="${3:-60}" sql line
  if [[ ! "$wait" =~ ^[0-9]+$ ]] || ((wait < 1)); then
    echo "$prefix: the deploy lock wait must be a whole number of seconds (at least 1)" >&2
    return 1
  fi
  case "$mode" in
    exclusive)
      sql="select pg_catalog.pg_try_advisory_lock($DB_DEPLOY_LOCK_KEY) as got \\gset
\\if :got
\\else
\\echo waiting
set lock_timeout = '${wait}s';
select pg_catalog.pg_advisory_lock($DB_DEPLOY_LOCK_KEY);
\\endif
\\echo locked"
      ;;
    shared-try)
      sql="select pg_catalog.pg_try_advisory_lock_shared($DB_DEPLOY_LOCK_KEY) as got \\gset
\\if :got
\\echo locked
\\else
\\echo busy
\\endif"
      ;;
    *)
      echo "$prefix: unknown deploy lock mode" >&2
      return 1
      ;;
  esac
  # The holder: one psql session that reads its commands from this shell and stays connected (idle)
  # until db_unlock closes its input. Query results go nowhere; \echo lines report the state.
  coproc DB_LOCK {
    PGAPPNAME=jadarat-deploy-lock exec psql -X -q -At --no-psqlrc -v ON_ERROR_STOP=1 -o /dev/null
  }
  # Kept apart: bash unsets DB_LOCK when the holder exits (e.g. on a lock timeout).
  DB_LOCK_HOLDER_PID="$DB_LOCK_PID"
  DB_LOCK_HOLDER_IN="${DB_LOCK[1]}"
  local out="${DB_LOCK[0]}"
  printf '%s\n' "set statement_timeout = 0; set idle_session_timeout = 0;" "$sql" >&"$DB_LOCK_HOLDER_IN"
  while IFS= read -r -t "$((wait + 60))" line <&"$out" 2>/dev/null; do
    case "$line" in
      waiting) echo "$prefix: another deploy, provisioning run or worker pass holds the deploy lock — waiting up to ${wait}s" ;;
      locked) return 0 ;;
      busy)
        db_unlock
        return 3
        ;;
    esac
  done
  db_unlock
  echo "$prefix: could not take the deploy lock (another run held it for more than ${wait}s, or the connection failed — see above)" >&2
  return 1
}

# db_unlock: ends the holder's session (and so the lock). Safe to call more than once, or without a lock.
db_unlock() {
  local fd="${DB_LOCK_HOLDER_IN:-}" pid="${DB_LOCK_HOLDER_PID:-}"
  DB_LOCK_HOLDER_IN="" DB_LOCK_HOLDER_PID=""
  # Close our end of its input only if bash has not closed it already (a failed `exec` redirection would
  # end this shell).
  if [[ -n "$fd" ]] && { true >&"$fd"; } 2>/dev/null; then exec {fd}>&-; fi
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}
