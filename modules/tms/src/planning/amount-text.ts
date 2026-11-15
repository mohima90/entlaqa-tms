/**
 * How a typed budget amount is read (EP-PLN, T-M3-04; Q2): in a file of its own so that a client component
 * which needs only this does not load the rest of the planning rules (bundle budget, CI gate 9). `rules.ts`
 * re-exports it; the `@jadarat/tms/amount-text` entry is the light import for the browser.
 */

/** An amount as typed: digits with up to 3 decimals, separators ignored; '' = no envelope (Q2). */
export function budgetAmountText(value: string): string | null | undefined {
  const plain = value.trim().replace(/[,\s٬]/gu, '');
  if (plain === '') return null;
  return /^\d{1,12}(\.\d{1,3})?$/.test(plain) ? plain : undefined;
}
