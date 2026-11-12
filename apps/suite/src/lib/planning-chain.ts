import type { ApprovalStep, StepKind } from '@jadarat/tms/planning-rules';

/**
 * The approval chain and reminder days as the planning forms edit them (EP-PLN A3/B4): pure helpers shared
 * by the server pages and the client editors, unit-tested.
 */

/** One approval step as edited (names as typed, approver '' = not chosen). */
export interface StepDraft {
  readonly key: string;
  readonly kind: StepKind;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly approverPersonId: string;
}

export interface MemberChoice {
  readonly personId: string;
  readonly name: string;
}

let nextKey = 0;
/** A key for a step row (React list key; never sent). */
export function stepKey(): string {
  nextKey += 1;
  return `step-${String(nextKey)}`;
}

export function toDrafts(steps: readonly ApprovalStep[]): StepDraft[] {
  return steps.map((step, index) => ({
    key: `saved-${String(index)}`,
    kind: step.kind,
    // A step saved with one name only (the default language's; PO, 12 Nov 2026) shows the other empty.
    nameAr: step.nameAr ?? '',
    nameEn: step.nameEn ?? '',
    approverPersonId: step.approverPersonId ?? '',
  }));
}

export function fromDrafts(drafts: readonly StepDraft[]): ApprovalStep[] {
  return drafts.map((draft) => ({
    kind: draft.kind,
    nameAr: draft.nameAr,
    nameEn: draft.nameEn,
    approverPersonId:
      draft.kind === 'person' && draft.approverPersonId ? draft.approverPersonId : null,
  }));
}

/** Reminder days as typed → numbers, or the text key of what is wrong. */
export function parseReminderDays(
  days: readonly string[],
): { readonly ok: true; readonly days: number[] } | { readonly ok: false; readonly key: string } {
  const values = days.map((d) => Number(d.trim() === '' ? Number.NaN : d.trim()));
  if (values.some((v) => !Number.isInteger(v) || v < 1 || v > 90)) {
    return { ok: false, key: 'setup.fieldErrors.dayRange' };
  }
  if (new Set(values).size !== values.length) {
    return { ok: false, key: 'setup.fieldErrors.duplicateDay' };
  }
  return { ok: true, days: values };
}

/** Required step names (client check before the server's), as `steps.N.field` → text. */
export function stepNameErrors(
  steps: readonly StepDraft[],
  required: string,
  /** The organization's default language: only its name is required (WP-FIX-03; PO, 12 Nov 2026). */
  nameLanguage: 'ar' | 'en',
): Record<string, string> {
  const errors: Record<string, string> = {};
  const field = nameLanguage === 'ar' ? 'nameAr' : 'nameEn';
  steps.forEach((step, index) => {
    if (step[field].trim() === '') errors[`steps.${String(index)}.${field}`] = required;
  });
  return errors;
}
