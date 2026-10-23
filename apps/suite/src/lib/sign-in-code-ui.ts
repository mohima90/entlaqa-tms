/**
 * Client-safe helpers of the e-mailed sign-in code screen (WP-ADM-05): the six boxes' editing rules, the
 * resend countdown and the plural of "tries left". Pure functions, unit-tested.
 */

export const CODE_LENGTH = 6;

/** Only the digits of what was typed, pasted or auto-filled (any script's digits count: «٣٤٥» → "345"). */
export function digitsOf(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
}

/**
 * The code after typing `raw` into box `index`: the digits replace what the boxes held from there on (a
 * pasted or auto-filled code arrives whole in one box), never more than six, never a gap — a box past the
 * end of the code fills the next free one. Returns the new value and the box to focus next.
 */
export function applyTyping(
  value: string,
  index: number,
  raw: string,
): { readonly value: string; readonly focus: number } {
  const digits = digitsOf(raw);
  const at = Math.min(Math.max(index, 0), value.length);
  if (digits === '') {
    // A box was emptied: its digit goes (the ones after it move up).
    const next = value.slice(0, at) + value.slice(at + 1);
    return { value: next, focus: Math.min(at, CODE_LENGTH - 1) };
  }
  const next = (value.slice(0, at) + digits + value.slice(at + digits.length)).slice(
    0,
    CODE_LENGTH,
  );
  return { value: next, focus: Math.min(at + digits.length, CODE_LENGTH - 1) };
}

/** A whole pasted code replaces the boxes' content. */
export function applyPaste(raw: string): { readonly value: string; readonly focus: number } {
  const value = digitsOf(raw).slice(0, CODE_LENGTH);
  return { value, focus: Math.min(value.length, CODE_LENGTH - 1) };
}

/** Backspace in an empty box deletes the digit before it. */
export function applyBackspace(
  value: string,
  index: number,
): { readonly value: string; readonly focus: number } | null {
  if (index < 1 || value.length > index) return null;
  return { value: value.slice(0, index - 1) + value.slice(index), focus: index - 1 };
}

/** "0:42" / "1:00": the resend countdown (digits stay Latin, read left to right). */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export type TriesForms = Readonly<Record<string, string>>;

/** "3 tries left" in the right plural form of the language (Arabic has six). */
export function triesLeftText(locale: string, count: number, forms: TriesForms): string {
  let category: string;
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    category = 'other';
  }
  const form = forms[category] ?? forms.other ?? '{n}';
  return form.replace('{n}', String(count));
}
