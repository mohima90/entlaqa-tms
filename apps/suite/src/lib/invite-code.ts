/**
 * Invitation codes on the client (Kawadir ATS, PO 16 Oct 2026; migration 20261018090000; security review
 * H1): 12 symbols of ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0/O or 1/I), shown grouped `XXXX-XXXX-XXXX`.
 * People type them in any case, with or without the hyphens or spaces: the field keeps the 12 symbols
 * upper-cased and shows them grouped, and only a complete code is looked up (each lookup counts against
 * the client's budget). The rules live in one place: @jadarat/platform-db/invitation-code.
 */
import {
  INVITATION_CODE_LENGTH,
  formatInvitationCode,
  isCompleteInvitationCode,
  typedInvitationCode,
} from '@jadarat/platform-db/invitation-code';

export const INVITE_CODE_LENGTH = INVITATION_CODE_LENGTH;

/** What the code field keeps: upper case, separators dropped, at most 12 symbols. */
export function typedInviteCode(raw: string): string {
  return typedInvitationCode(raw);
}

/** How a code is shown (`XXXX-XXXX-XXXX`; a legacy 43-character token as is). */
export function displayInviteCode(code: string): string {
  return formatInvitationCode(code);
}

/** A complete code (normalized), or a token of a link e-mailed before codes (43 base64url characters). */
export function isCompleteInviteCode(value: string): boolean {
  return isCompleteInvitationCode(value);
}
