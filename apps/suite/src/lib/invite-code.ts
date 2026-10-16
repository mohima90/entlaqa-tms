/**
 * Invitation codes on the client (Kawadir ATS, PO 16 Oct 2026; migration 20261018090000): 8 symbols of
 * ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0/O or 1/I). People type them in any case: the field upper-cases as
 * they type, and only a complete code is looked up (each lookup counts against the client's budget).
 */
export const INVITE_CODE_LENGTH = 8;

/** What the code field shows: upper case, spaces and dashes dropped, at most 8 characters. */
export function typedInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '').slice(0, INVITE_CODE_LENGTH);
}

/** A complete code, or a token of a link e-mailed before codes (43 base64url characters). */
export function isCompleteInviteCode(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{8}$/.test(value) || /^[A-Za-z0-9_-]{43}$/.test(value);
}
