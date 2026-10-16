/**
 * The invitation code's shape (FR-IAM-03; Kawadir ATS, PO 16 Oct 2026; security review H1): 12 symbols of
 * ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0/O or 1/I) — 60 random bits — issued by the database
 * (private.new_invitation_code, migration 20261018090000) and compared by the sign-up gate as the 12
 * upper-case characters. People see it grouped `XXXX-XXXX-XXXX` and may type it with or without the
 * hyphens or spaces, in any case: everything is normalized to the 12 characters before it is hashed
 * (token_hash = SHA-256 of the normalized code). Links e-mailed before codes carry a 43-character
 * base64url token, still accepted while such links live.
 *
 * The one place these rules live in TypeScript: the server (platform-db, platform-identity, the zod inputs)
 * and the browser (the sign-up page's field, the copy controls) import them from here. Plain module — no
 * `server-only`, no Node APIs — so client components may import `@jadarat/platform-db/invitation-code`.
 */

export const INVITATION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Symbols in a code (5 bits each: 60 random bits). */
export const INVITATION_CODE_LENGTH = 12;
/** Symbols per group in the displayed form `XXXX-XXXX-XXXX`. */
export const INVITATION_CODE_GROUP = 4;
/** A normalized code: exactly what the database stores and the sign-up gate compares. */
export const INVITATION_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;
/** A link token e-mailed before codes (32 random bytes, base64url): still accepted while such links live. */
export const LEGACY_INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** What a lookup or acceptance may carry once normalized: a code or a legacy token. */
export const INVITATION_SECRET_PATTERN = /^(?:[A-HJ-NP-Z2-9]{12}|[A-Za-z0-9_-]{43})$/;

/** Hyphens (ASCII and the Unicode dashes people paste) and whitespace that separate the groups. */
const SEPARATORS = /[\s\-‐-―−]/g;

/**
 * What a visitor typed or the link carried, as the database compares it: a code without its grouping
 * (hyphens, spaces) and upper-cased; a legacy 43-character token unchanged (it is case-sensitive and may
 * contain `-`); null for anything else.
 */
export function normalizeInvitationCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (LEGACY_INVITATION_TOKEN_PATTERN.test(trimmed)) return trimmed;
  const code = trimmed.replace(SEPARATORS, '').toUpperCase();
  return INVITATION_CODE_PATTERN.test(code) ? code : null;
}

/** The displayed form of a code: `XXXX-XXXX-XXXX` (a legacy token or a partial code: grouped as far as it goes). */
export function formatInvitationCode(code: string): string {
  if (LEGACY_INVITATION_TOKEN_PATTERN.test(code)) return code;
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += INVITATION_CODE_GROUP) {
    groups.push(code.slice(i, i + INVITATION_CODE_GROUP));
  }
  return groups.join('-');
}

/**
 * The sign-up page's code field as the visitor types: separators dropped, upper case, at most 12 symbols
 * (the field shows `formatInvitationCode` of it).
 */
export function typedInvitationCode(raw: string): string {
  return raw.replace(SEPARATORS, '').toUpperCase().slice(0, INVITATION_CODE_LENGTH);
}

/** A complete code (normalized) or a legacy token: worth looking up (each lookup counts against a budget). */
export function isCompleteInvitationCode(value: string): boolean {
  return INVITATION_SECRET_PATTERN.test(value);
}
