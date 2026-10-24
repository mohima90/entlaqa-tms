/**
 * Stored bytes in gigabytes as the plans count them (WP-ADM-06: 1 GB = 1024³ bytes, private.plans), one
 * decimal below 10 GB («3.2»), whole above («142»), Latin digits in both languages.
 */
export function gigabytes(bytes: number, locale: string): string {
  const gb = bytes / 1024 ** 3;
  return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
    maximumFractionDigits: gb < 10 ? 1 : 0,
  }).format(gb);
}
