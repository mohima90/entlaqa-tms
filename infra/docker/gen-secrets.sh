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
  # Name-constrained: this CA can only vouch for the stack's own hosts, never for public sites the app
  # calls (it is trusted process-wide through NODE_EXTRA_CA_CERTS).
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 825 \
    -subj "/CN=Jadarat self-hosted CA" -keyout "$S/ca.key" -out "$S/ca.crt" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=critical,permitted;DNS:db,permitted;DNS:gateway,permitted;DNS:localhost,permitted;IP:127.0.0.1/255.255.255.255" \
    2>/dev/null
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
# Certificates are public; private keys stay 0600. The db entrypoint copies its key (root can read it);
# the gateway key is handed to nginx's unprivileged user (uid 101) by ownership, not by widening the mode.
chmod 644 "$S"/*.crt
chmod 600 "$S"/*.key
if [[ "$(id -u)" == "0" ]]; then chown 101:101 "$S/gateway.key"; else chmod 644 "$S/gateway.key"; fi

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
  pw() {
    local p
    p="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48)"
    [[ ${#p} -ge 40 ]] || { echo "gen-secrets: could not generate a password" >&2; exit 1; }
    printf '%s' "$p"
  }
  AUTH_DB_PASSWORD="$(pw)"
  # The database only ever receives a SCRAM verifier (never the clear password: DDL may be logged).
  AUTH_DB_PASSWORD_SCRAM="$(AUTH_DB_PASSWORD="$AUTH_DB_PASSWORD" node --input-type=module -e "
    import { scramSha256Verifier } from '../../scripts/lib/scram.mjs';
    process.stdout.write(scramSha256Verifier(process.env.AUTH_DB_PASSWORD));
  ")"
  {
    echo "POSTGRES_PASSWORD=$(pw)"
    echo "AUTH_DB_PASSWORD=$AUTH_DB_PASSWORD"
    # Single quotes: literal for compose's --env-file (the verifier contains '$', the JWK contains quotes).
    echo "AUTH_DB_PASSWORD_SCRAM='$AUTH_DB_PASSWORD_SCRAM'"
    echo "APP_SERVER_DB_PASSWORD=$(pw)"
    echo "APP_WORKER_DB_PASSWORD=$(pw)"
    echo "JWT_SECRET=$(pw)"
    echo "JWT_KEYS='[$(cat "$S/jwt-private.jwk.json")]'"
  } >"$S/.env"
fi
echo "gen-secrets: ready in infra/docker/$S"
