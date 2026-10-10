// Client-safe shape checks for authenticator and set-up codes (FR-IAM-12, T-M2-10). No zod here: this module
// is imported by client components; the server validates again with the schemas in `./totp-code`.

/** Six digits in any script (spaces allowed) — the client's check before sending; the server checks again. */
export function looksLikeTotpCode(value: string): boolean {
  return /^[0-9٠-٩۰-۹]{6}$/.test(value.replace(/\s/g, ''));
}

/** Eight digits in any script (spaces allowed) — the client's check before sending. */
export function looksLikeEmailSetupCode(value: string): boolean {
  return /^[0-9٠-٩۰-۹]{8}$/.test(value.replace(/\s/g, ''));
}
