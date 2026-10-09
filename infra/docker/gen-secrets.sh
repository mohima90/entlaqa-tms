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

# Mail (T-M2-06b): Mailpit stands in for the installation's mail relay in this stack. Its certificate
# comes from a separate CA that may vouch for `mailpit` only and is trusted by the worker's SMTP client
# alone (SMTP_CA_CERT_FILE), so the main CA keeps its name constraints. A real relay brings its own PKI.
if [[ ! -f "$S/mail-ca.crt" ]]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 825 \
    -subj "/CN=Jadarat self-hosted mail CA" -keyout "$S/mail-ca.key" -out "$S/mail-ca.crt" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=critical,permitted;DNS:mailpit" 2>/dev/null
fi
if [[ ! -f "$S/mailpit.crt" ]]; then
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/CN=mailpit" \
    -keyout "$S/mailpit.key" -out "$S/mailpit.csr" 2>/dev/null
  printf 'subjectAltName=DNS:mailpit\nextendedKeyUsage=serverAuth\n' >"$S/mailpit.ext"
  openssl x509 -req -in "$S/mailpit.csr" -CA "$S/mail-ca.crt" -CAkey "$S/mail-ca.key" -CAcreateserial \
    -days 397 -extfile "$S/mailpit.ext" -out "$S/mailpit.crt" 2>/dev/null
  rm -f "$S/mailpit.csr" "$S/mailpit.ext"
fi
# Certificates are public; private keys stay 0600. The db entrypoint copies its key (root can read it);
# the gateway key is handed to nginx's unprivileged user (uid 101) by ownership, not by widening the mode.
chmod 644 "$S"/*.crt
chmod 600 "$S"/*.key
if [[ "$(id -u)" == "0" ]]; then chown 101:101 "$S/gateway.key"; else chmod 644 "$S/gateway.key"; fi
# Mailpit runs as root without capabilities: it reads its key as the owner, or a readable copy when the
# stack is set up by an ordinary user (it is the test relay's key only).
if [[ "$(id -u)" != "0" ]]; then chmod 644 "$S/mailpit.key"; fi

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

# Values added after the first release are appended to an existing .env (upgrades keep old secrets).
add_secret() {
  grep -q "^$1=" "$S/.env" && return 0
  [[ -z "$(tail -c1 "$S/.env")" ]] || echo >>"$S/.env" # a hand-edited file may lack the final newline
  printf '%s=%s\n' "$1" "$2" >>"$S/.env"
}
pw2() {
  local p
  p="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
  [[ ${#p} -ge 32 ]] || { echo "gen-secrets: could not generate a password" >&2; exit 1; }
  printf '%s' "$p"
}
add_secret ERRORS_DB_PASSWORD "$(pw2)"
add_secret GLITCHTIP_SECRET_KEY "$(pw2)$(pw2)"
add_secret GLITCHTIP_ADMIN_PASSWORD "$(pw2)"
add_secret APP_QUEUE_DB_PASSWORD "$(pw2)"
# Auth's signing key (written with a new .env; written again after a key rotation, README.md "Auth admin
# key"). Auth, the worker's token and admin-cli must all use the key in jwt-private.jwk.json.
add_secret JWT_KEYS "'[$(cat "$S/jwt-private.jwk.json")]'"
kid="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).kid)' \
  "$S/jwt-private.jwk.json")"
grep -q "^JWT_KEYS=.*\"kid\":\"$kid\"" "$S/.env" ||
  { echo "gen-secrets: JWT_KEYS in .env is not the key in jwt-private.jwk.json (README.md, \"Auth admin key\")" >&2; exit 1; }
# The WORKER's Auth admin key (T-M2-17): a service_role token signed with the installation's ES256 key,
# valid 90 days, for password-reset links (Auth's admin generate_link). Compose hands it to the workers
# only (SUPABASE_SECRET_KEY) — never to the app — and the gateway serves the admin API only on the
# internal auth-admin network (generate_link only). RENEWAL: re-running this script replaces it once
# fewer than 30 days are left (the workers log a warning from then on), after a signing-key rotation, or
# when it is an earlier build's one-year token;
# then `docker compose … up -d worker`. To revoke it at once, rotate the signing key (README.md, "Auth
# admin key"). The token is decoded here only, never printed.
admin_token_needs_renewal() {
  WORKER_TOKEN="$(sed -n 's/^WORKER_AUTH_ADMIN_TOKEN=//p' "$S/.env")" node -e '
    try {
      const kid = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).kid;
      const [head, body] = process.env.WORKER_TOKEN.split(".").slice(0, 2)
        .map((part) => JSON.parse(Buffer.from(part, "base64url")));
      const left = body.exp - Date.now() / 1000; // a one-year token of an earlier build is replaced too
      process.exit(head.kid === kid && left >= 30 * 86400 && left <= 91 * 86400 ? 1 : 0);
    } catch { process.exit(0); }
  ' "$S/jwt-private.jwk.json"
}
if grep -q '^WORKER_AUTH_ADMIN_TOKEN=' "$S/.env" && admin_token_needs_renewal; then
  { grep -v '^WORKER_AUTH_ADMIN_TOKEN=' "$S/.env" || true; } >"$S/.env.new"
  mv "$S/.env.new" "$S/.env"
  echo "gen-secrets: renewed the worker's Auth admin token (under 30 days left, another signing key or an" \
    "earlier build's) — restart the workers: docker compose --env-file .secrets/.env up -d worker"
fi
if ! grep -q '^WORKER_AUTH_ADMIN_TOKEN=' "$S/.env"; then
  token="$(node -e '
    const { createPrivateKey, randomUUID, sign } = require("node:crypto");
    const jwk = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: "ES256", typ: "JWT", kid: jwk.kid });
    const body = b64({ role: "service_role", iss: "jadarat-worker", iat: now, exp: now + 90 * 86400, jti: randomUUID() });
    const sig = sign("sha256", Buffer.from(`${head}.${body}`), {
      key: createPrivateKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }).toString("base64url");
    process.stdout.write(`${head}.${body}.${sig}`);
  ' "$S/jwt-private.jwk.json")"
  [[ "$token" =~ ^ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] ||
    { echo "gen-secrets: could not sign the worker's Auth admin token" >&2; exit 1; }
  add_secret WORKER_AUTH_ADMIN_TOKEN "$token"
  unset token
fi

# No Auth secret key for the app (T-M2-07, security review H1): invitees sign up through the public API.
# An installation set up before this change may still hold SUPABASE_SECRET_KEY (a service_role token
# minted here): it is removed from .env. A removed token stays valid until its own expiry (one year from
# minting); to end it at once, rotate the ES256 signing key (README.md, "Sign-ups and invitations").
if grep -q '^SUPABASE_SECRET_KEY=' "$S/.env"; then
  { grep -v '^SUPABASE_SECRET_KEY=' "$S/.env" || true; } >"$S/.env.new"
  mv "$S/.env.new" "$S/.env"
  echo "gen-secrets: removed SUPABASE_SECRET_KEY from .env (the app no longer uses an Auth admin key)"
fi
echo "gen-secrets: ready in infra/docker/$S"
