/**
 * Our e-mail error codes in plain words (WP-ADM-01; message keys `emailSettings.reasons.<CODE>`): the
 * provider's own texts are never kept (they may quote addresses), so the pages explain our codes. Unknown
 * codes are shown as they are.
 */
export function reasonText(code: string | null, texts: Readonly<Record<string, string>>): string {
  if (code && /^[A-Z0-9_]{2,64}$/.test(code)) {
    const known = texts[`reasons.${code}`];
    if (known) return known;
    return (texts['reasons.other'] ?? '{code}').replace('{code}', code);
  }
  return texts['reasons.SEND_FAILED'] ?? '';
}
