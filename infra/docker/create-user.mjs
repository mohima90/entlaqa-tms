#!/usr/bin/env node
// Creates a confirmed Auth user through the self-hosted Auth admin API (no public sign-up exists).
// Usage: node create-user.mjs <email>   (password from env NEW_USER_PASSWORD; prints only the user id)
// The admin call is authorised by a 60-second service_role token signed with the installation's ES256
// key (.secrets/jwt-private.jwk.json) — the key never leaves this machine.
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

const email = process.argv[2];
const password = process.env.NEW_USER_PASSWORD;
if (!email || !password) {
  console.error('usage: NEW_USER_PASSWORD=… node create-user.mjs <email>');
  process.exit(2);
}
const dir = new URL('.secrets/', import.meta.url);
const jwk = JSON.parse(readFileSync(new URL('jwt-private.jwk.json', dir), 'utf8'));
const ca = readFileSync(new URL('ca.crt', dir));

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64({ alg: 'ES256', typ: 'JWT', kid: jwk.kid });
const payload = b64({
  role: 'service_role',
  iss: 'jadarat-admin-cli',
  iat: now,
  exp: now + 60,
  jti: randomUUID(),
});
const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
  key: createPrivateKey({ key: jwk, format: 'jwk' }),
  dsaEncoding: 'ieee-p1363',
}).toString('base64url');

const url = new URL(`${process.env.AUTH_URL ?? 'https://localhost:8443/auth/v1'}/admin/users`);
const payloadBody = JSON.stringify({ email, password, email_confirm: true });
const { status, body } = await new Promise((resolve, reject) => {
  const req = request(
    url,
    {
      method: 'POST',
      ca, // verify the gateway against the installation's CA (no insecure TLS)
      headers: {
        authorization: `Bearer ${header}.${payload}.${signature}`,
        apikey: 'self-hosted',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payloadBody),
      },
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data || '{}') }));
    },
  );
  req.on('error', reject);
  req.end(payloadBody);
});
if (status < 200 || status >= 300) {
  console.error(`create-user: Auth answered ${status} ${body.msg ?? body.error_description ?? ''}`);
  process.exit(1);
}
process.stdout.write(`${body.id}\n`);
