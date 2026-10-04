#!/usr/bin/env node
// ADR 0010 §3a parity checks against the self-hosted Auth server (T-M1-D04), for a throw-away user:
//   1. asymmetric signing: the access token is ES256, its `kid` is published at /.well-known/jwks.json and
//      the signature verifies locally against that key (what `getClaims()` relies on);
//   2. the token carries `session_id` (needed by the Custom Access Token hook, ADR 0002 §3);
//   3. TOTP MFA: enrol → challenge → verify yields an `aal2` token with `totp` in `amr`.
// Usage: PARITY_EMAIL=… PARITY_PASSWORD=… node check-auth-parity.mjs   (prints one line per check)
import { createHmac, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

const base = new URL(`${process.env.AUTH_URL ?? 'https://localhost:8443/auth/v1'}/`);
const ca = readFileSync(new URL('.secrets/ca.crt', import.meta.url));
const { PARITY_EMAIL: email, PARITY_PASSWORD: password } = process.env;
if (!email || !password) throw new Error('PARITY_EMAIL and PARITY_PASSWORD are required');

function call(method, path, { token, body } = {}) {
  const data = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(path, base),
      {
        method,
        ca,
        headers: {
          apikey: 'self-hosted',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(data
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          const json = text ? JSON.parse(text) : {};
          if ((res.statusCode ?? 500) >= 300)
            reject(new Error(`${method} ${path}: ${res.statusCode} ${json.msg ?? ''}`));
          else resolve(json);
        });
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) process.exitCode = 1;
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret. */
function totp(secretBase32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const session = await call('POST', 'token?grant_type=password', { body: { email, password } });
const [h, p, s] = session.access_token.split('.');
const header = decode(h);
const claims = decode(p);
const jwks = await call('GET', '.well-known/jwks.json');
const jwk = jwks.keys.find((k) => k.kid === header.kid);
check('access token is ES256 with a kid published in JWKS', header.alg === 'ES256' && Boolean(jwk));
check(
  'token signature verifies locally against the JWKS key',
  Boolean(jwk) &&
    verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    ),
);
check(
  'token carries session_id and aal1',
  typeof claims.session_id === 'string' && claims.aal === 'aal1',
);

const factor = await call('POST', 'factors', {
  token: session.access_token,
  body: { factor_type: 'totp', friendly_name: 'parity' },
});
const challenge = await call('POST', `factors/${factor.id}/challenge`, {
  token: session.access_token,
  body: {},
});
const verified = await call('POST', `factors/${factor.id}/verify`, {
  token: session.access_token,
  body: { challenge_id: challenge.id, code: totp(factor.totp.secret) },
});
const mfaClaims = decode(verified.access_token.split('.')[1]);
check(
  'TOTP enrol + verify gives aal2 with totp in amr',
  mfaClaims.aal === 'aal2' && (mfaClaims.amr ?? []).some((a) => a.method === 'totp'),
);
