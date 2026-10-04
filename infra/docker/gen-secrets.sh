#!/usr/bin/env bash
# Generates everything a self-hosted (sovereign) stack needs, into infra/docker/.secrets (git-ignored, 0700):
# a private CA, TLS certificates for the database and the auth gateway, the ES256 JWT signing key (JWK),
# and .env with random passwords. Run once per installation; re-running keeps existing files.
# Production: replace the CA/certificates with the customer's PKI and keep these files in a vault.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
S=.secrets
mkdir -p "$S" && chmod 700 "$S"
umask 077

if [[ ! -f "$S/ca.crt" ]]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 825 \
    -subj "/CN=Jadarat self-hosted CA" -keyout "$S/ca.key" -out "$S/ca.crt" 2>/dev/null
fi

# cert <name> <SANs>: server certificate signed by the CA.
cert() {
  local name="$1" san="$2"
  [[ -f "$S/$name.crt" ]] && return 0
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/CN=$name" \
    -keyout "$S/$name.key" -out "$S/$name.csr" 2>/dev/null
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san" >"$S/$name.ext"
  openssl x509 -req -in "$S/$name.csr" -CA "$S/ca.crt" -CAkey "$S/ca.key" -CAcreateserial \
    -days 397 -extfile "$S/$name.ext" -out "$S/$name.crt" 2>/dev/null
  rm -f "$S/$name.csr" "$S/$name.ext"
}
cert db "DNS:db,DNS:localhost,IP:127.0.0.1"
cert gateway "DNS:gateway,DNS:localhost,IP:127.0.0.1"
# Certificates are public. The DB key is copied (owner postgres, 0600) by the db entrypoint; the gateway
# key must be readable by nginx's unprivileged user inside its container. The CA key stays 0600.
chmod 644 "$S"/*.crt "$S/db.key" "$S/gateway.key"
chmod 600 "$S/ca.key"

if [[ ! -f "$S/jwt-private.jwk.json" ]]; then
  node -e '
    const { generateKeyPairSync, randomUUID } = require("node:crypto");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = { ...privateKey.export({ format: "jwk" }), kid: randomUUID(), alg: "ES256", use: "sig",
                  key_ops: ["sign", "verify"] };
    process.stdout.write(JSON.stringify(jwk));
  ' >"$S/jwt-private.jwk.json"
fi

if [[ ! -f "$S/.env" ]]; then
  pw() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48; }
  {
    echo "POSTGRES_PASSWORD=$(pw)"
    echo "AUTH_DB_PASSWORD=$(pw)"
    echo "APP_SERVER_DB_PASSWORD=$(pw)"
    echo "APP_WORKER_DB_PASSWORD=$(pw)"
    echo "JWT_SECRET=$(pw)"
    echo "JWT_KEYS=[$(cat "$S/jwt-private.jwk.json")]"
  } >"$S/.env"
fi
echo "gen-secrets: ready in infra/docker/$S"
