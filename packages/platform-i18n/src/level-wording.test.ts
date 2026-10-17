import { describe, expect, it } from 'vitest';
import ar from '../messages/ar.json';
import en from '../messages/en.json';

/**
 * The organization's own level names instead of a fixed «Department» (guided-test feedback #3, PO 17 Oct
 * 2026; FR-ADM-05): no message names a structure unit with the fixed word. Units are «Unit» / «الوحدة» (or
 * the organization's level name, filled in by the page), heads are «Head» / «الرئيس» or «unit heads» /
 * «رؤساء الوحدات». A new message that says "department" fails here: use the neutral word, or add it to the
 * allow-list below with the reason.
 */

interface Messages {
  readonly [key: string]: string | Messages;
}

function flatten(messages: Messages, prefix = ''): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value] as [string, string]] : flatten(value, path);
  });
}

/** Intentional uses, with why. */
const ALLOWED: Readonly<Record<string, string>> = {
  // The standard role's name, BRD §4.2 / glossary #22 (role names follow the BRD exactly).
  'deactivation.noCandidates': 'names the Department Head role',
  'structure.form.headHint': 'names the Department Head role',
  // Example level names an organization may choose.
  'structure.levels.example': 'example level names',
};

/** Arabic words for a department (and its head). In the needs-form builder «القسم» means a form section. */
const AR_DEPARTMENT =
  /(^|[\s«(])(ال)?(قسم|أقسام)(ه|ها|هم|ك|كم)?(?=$|[\s».،:)؟])|إدارة محددة|بإدارة/;
const AR_HEADS = /رئيس (ال)?قسم|رؤساء (ال)?أقسام/;

describe('no fixed «Department» in the messages (guided-test feedback #3)', () => {
  it('English: no "department" outside the allow-list', () => {
    const found = flatten(en as Messages)
      .filter(([key, text]) => /department/i.test(text) && !(key in ALLOWED))
      .map(([key]) => key);
    expect(found).toEqual([]);
  });

  it('Arabic: no «قسم» / «أقسام» for a unit, no «رئيس القسم» outside the allow-list', () => {
    const found = flatten(ar as Messages)
      .filter(([key, text]) => {
        if (key in ALLOWED) return false;
        // Form sections («القسم») are the needs-form builder's own word; its department heads are not.
        if (key.startsWith('needsForms.')) return AR_HEADS.test(text);
        return AR_DEPARTMENT.test(text) || AR_HEADS.test(text);
      })
      .map(([key]) => key);
    expect(found).toEqual([]);
  });

  it('the allow-list stays current (each entry still exists and still needs it)', () => {
    const english = Object.fromEntries(flatten(en as Messages));
    for (const key of Object.keys(ALLOWED)) {
      expect(english[key], key).toMatch(/department/i);
    }
  });

  it('heads and units have their neutral words in both languages', () => {
    const english = Object.fromEntries(flatten(en as Messages));
    const arabic = Object.fromEntries(flatten(ar as Messages));
    expect([english['users.columns.department'], arabic['users.columns.department']]).toEqual([
      'Unit',
      'الوحدة',
    ]);
    expect([
      english['planning.setup.approvals.kinds.department_heads'],
      arabic['planning.setup.approvals.kinds.department_heads'],
    ]).toEqual(['Unit heads', 'رؤساء الوحدات']);
    expect([english['planning.cycle.columns.head'], arabic['planning.cycle.columns.head']]).toEqual(
      ['Head', 'الرئيس'],
    );
  });
});
