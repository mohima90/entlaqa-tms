/**
 * The Grades page's pure helpers (WP-ADM-04; design S04-5): the code as typed, checked the way the server
 * and the database check it (platform-rbac GradeCode, platform.grades grades_code_check), so a wrong code is
 * told «on press», on the field, without a round trip. The server repeats every rule.
 */

/** Arabic-Indic and Persian digits become Latin (codes stay in Latin digits). */
function latinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export type GradeCodeProblem = 'required' | 'format';

/**
 * The grade code as it will be saved, or why not: surrounding spaces go; 1-12 characters; no spaces, control or
 * invisible formatting characters inside; at least one letter or digit (`7`, `G7`, `#7`, `G-7` pass; `---`
 * and `G 7` do not).
 */
export function checkGradeCode(
  raw: string,
): { readonly code: string } | { readonly problem: GradeCodeProblem } {
  const code = latinDigits(raw).trim();
  if (code === '') return { problem: 'required' };
  if (Array.from(code).length > 12) return { problem: 'format' };
  if (/[\s\p{Cc}\p{Cf}]/u.test(code)) return { problem: 'format' };
  if (!/[\p{L}\p{N}]/u.test(code)) return { problem: 'format' };
  return { code };
}

/** One row of the list as the page formats it on the server (plural texts need the server's i18n). */
export interface GradeRowView {
  readonly id: string;
  readonly code: string;
  readonly people: number;
  /** «3 people» / «No one». */
  readonly peopleText: string;
  readonly renameLabel: string;
  readonly deleteLabel: string;
  /** «2 people have this grade. They will show the new code.» (only when someone holds it). */
  readonly editNote: string | null;
  readonly editTitle: string;
  readonly deleteTitle: string;
  readonly blockedTitle: string;
  readonly blockedText: string;
}
