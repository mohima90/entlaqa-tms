/**
 * E-mail addresses in messages and the delivery log (ADR 0008 §7): a strict enough syntax check
 * (one @, no spaces, angle brackets, control or invisible formatting characters, a dotted domain) and
 * the masked form kept in the log.
 */
const ADDRESS =
  /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && ADDRESS.test(value) && !/[\p{Cc}\p{Cf}]/u.test(value);
}

/** `n.aldossari@alraya.example` → `n***@alraya.example`. */
export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}
