import { describe, expect, it } from 'vitest';
import ar from '../messages/ar.json';
import en from '../messages/en.json';

/**
 * One word for a part of the organization (word list approved by the PO, 27 Oct 2026; FR-ADM-05): where a
 * screen knows the level, it says the level's own name (filled in by the page: «Add Section»); where it does
 * not, the general word is «Department» / «الإدارة» — never «unit» / «الوحدة», which the PO's team read as a
 * second thing next to their departments (role-play feedback #9). «قسم» stays out as the general word too
 * (it is a Division or a form section). A new message that says "unit" fails here: use «Department», or add
 * it to the allow-list below with the reason.
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

/** Intentional uses of «unit» / «وحدة» that are not a part of the organization, with why. */
const ALLOWED: Readonly<Record<string, string>> = {
  // The suite's modules (glossary #3): «Modules» / «الوحدات».
  'shell.modules': 'the suite modules',
  'shell.emptyBody': 'the Training module',
  'shell.yourPagesIntro': 'the Training module',
  'rolesPage.matrixNote': 'permissions per module',
  'roleBuilder.permissionsHint': 'permissions per module',
  // Excel macros («وحدات ماكرو»).
  'userImport.fileStates.refused.FILE_MACROS.title': 'Excel macros',
  'userImport.fileStates.refused.FILE_MACROS.body': 'Excel macros',
  'structure.import.file.FILE_MACROS': 'Excel macros',
  // The standard role's name «Department head» / «رئيس القسم» (BRD §4.2, glossary #22).
  'deactivation.noCandidates': 'names the Department Head role',
  'structure.form.headHint': 'names the Department Head role',
  // Example level names an organization may choose (Sector → Department → Section).
  'structure.levels.example': 'example level names',
};

/** «unit(s)» as a word, outside ICU placeholders such as {unit} — the branches of a plural still count. */
const EN_UNIT = /\bunits?\b/i;
const withoutPlaceholders = (text: string) =>
  text.replace(/\{\s*\w+\s*\}/g, '').replace(/\{\s*\w+\s*,\s*\w+\s*,/g, '');
/** The Arabic word for a unit in its forms (وحدة، وحدات، وحدتان، وحدتين، وحدته…), not وحده / وحدك / وحدود. */
const AR_UNIT = /وحد(ة|ات|ت(ان|ين|ه|ها|هم|ك|كم|ي))/;
/** Arabic words for a division / section used as the general word (needs-form sections keep «القسم»). */
const AR_DIVISION = /(^|[\s«(])(ال)?(قسم|أقسام)(ه|ها|هم|ك|كم)?(?=$|[\s».،:)؟])/;
const AR_HEADS = /رئيس (ال)?قسم|رؤساء (ال)?أقسام/;

describe('one word for a part of the organization (word list, PO 27 Oct 2026)', () => {
  it('English: no "unit" outside the allow-list', () => {
    const found = flatten(en as Messages)
      .filter(([key, text]) => EN_UNIT.test(withoutPlaceholders(text)) && !(key in ALLOWED))
      .map(([key]) => key);
    expect(found).toEqual([]);
  });

  it('Arabic: no «وحدة» for a part of the organization, no «قسم» as the general word', () => {
    const found = flatten(ar as Messages)
      .filter(([key, text]) => {
        if (key in ALLOWED) return false;
        if (key.startsWith('needsForms.')) return AR_UNIT.test(text) || AR_HEADS.test(text);
        return AR_UNIT.test(text) || AR_DIVISION.test(text) || AR_HEADS.test(text);
      })
      .map(([key]) => key);
    expect(found).toEqual([]);
  });

  it('the general word is there: the menu says Departments, the people forms say Department', () => {
    const english = Object.fromEntries(flatten(en as Messages));
    const arabic = Object.fromEntries(flatten(ar as Messages));
    expect(english['shell.structure']).toBe('Departments');
    expect(arabic['shell.structure']).toBe('الإدارات');
    expect(english['users.department']).toBe('Department');
    expect(arabic['users.department']).toBe('الإدارة');
    expect(english['shell.emailIntegration']).toBe('Email settings');
  });

  it('the allow-list stays current (each entry still exists and still needs it)', () => {
    const english = Object.fromEntries(flatten(en as Messages));
    const arabic = Object.fromEntries(flatten(ar as Messages));
    for (const key of Object.keys(ALLOWED)) {
      expect(english[key], key).toBeDefined();
      const text = arabic[key] ?? '';
      expect(
        EN_UNIT.test(withoutPlaceholders(english[key] ?? '')) ||
          AR_UNIT.test(text) ||
          AR_DIVISION.test(text) ||
          AR_HEADS.test(text),
        `${key} no longer needs the allow-list`,
      ).toBe(true);
    }
  });
});
