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
