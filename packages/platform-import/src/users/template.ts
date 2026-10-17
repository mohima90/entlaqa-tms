import { CSV_BOM, csvLine } from '../spreadsheet/csv';
import {
  type WriterSheet,
  type WriterValidation,
  columnLetters,
  sheetReference,
  writeXlsx,
} from '../spreadsheet/xlsx-writer';
import { FIELD_DEFINITIONS } from './fields';
import { IMPORTABLE_ROLES } from './roles';

/**
 * The import template (T-M2-12, approved screens 2 and 3; design README §3): headers in Arabic or
 * English, no example rows (so they cannot be imported by mistake). XLSX: «المستخدمون» (headers, drop-down
 * lists, right to left in Arabic), «تعليمات» (the column guide), «القوائم» (this organization's
 * departments and branches, the roles an import may give, the languages). CSV: the header row only,
 * UTF-8 with BOM.
 */
export type TemplateLocale = 'ar' | 'en';

export interface TemplateUnit {
  readonly code: string | null;
  readonly nameAr: string;
  readonly nameEn: string | null;
}

export interface TemplateLists {
  readonly departments: readonly TemplateUnit[];
  readonly branches: readonly TemplateUnit[];
}

/** Rows the drop-down lists cover (the row limit plus the header). */
const LIST_ROWS = 10_001;

const SHEET_NAMES = {
  ar: { users: 'المستخدمون', guide: 'تعليمات', lists: 'القوائم' },
  en: { users: 'Users', guide: 'Instructions', lists: 'Lists' },
} as const;

export function templateFileName(locale: TemplateLocale, kind: 'csv' | 'xlsx'): string {
  return `${locale === 'ar' ? 'قالب-استيراد-المستخدمين' : 'user-import-template'}.${kind}`;
}

export function templateHeaders(locale: TemplateLocale): string[] {
  return FIELD_DEFINITIONS.map((d) => d.header[locale]);
}

export function csvTemplate(locale: TemplateLocale): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${CSV_BOM}${csvLine(templateHeaders(locale))}`);
}

const GUIDE_TEXT = {
  ar: {
    header: ['العمود', 'Column', 'الإلزام', 'الوصف', 'Description', 'مثال'],
    required: 'مطلوب',
    optional: 'اختياري',
    intro:
      'يُكتب عنوان كل عمود في الصف الأول، بالعربية أو بالإنجليزية. ترتيب الأعمدة غير مهم، ويمكن حذف الأعمدة الاختيارية التي لا تحتاج إليها.',
    never: [
      'ما لا يُستورد من ملف:',
      'حالة الحساب وكلمة المرور: يُضاف الجدد بدعوة، ويُعطَّل الحساب من ملف صاحبه.',
      'الأدوار المميزة (مدير المنظمة، مدير الموارد البشرية، المدير المالي، مسؤول الامتثال، المدقق): تُسند من ملف كل مستخدم.',
      'البيانات الخاصة مثل الجنس وتاريخ الميلاد ورقم الهوية.',
    ],
    lists: ['القسم', 'رمز القسم', 'الفرع', 'رمز الفرع', 'الدور', 'اللغة'],
  },
  en: {
    header: ['Column', 'العمود', 'Required', 'Description', 'الوصف', 'Example'],
    required: 'Required',
    optional: 'Optional',
    intro:
      'Write each column’s header in the first row, in Arabic or English. Column order doesn’t matter, and you can delete optional columns you don’t need.',
    never: [
      'Never imported from a file:',
      'Account status and passwords: new people are added with an invitation; accounts are deactivated from each profile.',
      'Privileged roles (Organization Admin, HR Manager, Finance Manager, Compliance Officer, Auditor): given from each user’s profile.',
      'Restricted personal data such as gender, date of birth and national ID.',
    ],
    lists: ['Department', 'Department code', 'Branch', 'Branch code', 'Role', 'Language'],
  },
} as const;

const unitName = (unit: TemplateUnit, locale: TemplateLocale) =>
  locale === 'en' && unit.nameEn ? unit.nameEn : unit.nameAr;

export function xlsxTemplate(
  locale: TemplateLocale,
  lists: TemplateLists,
): Uint8Array<ArrayBuffer> {
  const names = SHEET_NAMES[locale];
  const text = GUIDE_TEXT[locale];
  const rtl = locale === 'ar';
  const languages = ['العربية', 'English'];
  const roles = IMPORTABLE_ROLES.map((role) => role.name[locale]);

  // «القوائم»: one column per list.
  const columns: (readonly string[])[] = [
    lists.departments.map((d) => unitName(d, locale)),
    lists.departments.map((d) => d.code ?? ''),
    lists.branches.map((b) => unitName(b, locale)),
    lists.branches.map((b) => b.code ?? ''),
    roles,
    languages,
  ];
  const height = Math.max(...columns.map((c) => c.length));
  const listRows: string[][] = [[...text.lists]];
  for (let r = 0; r < height; r += 1) listRows.push(columns.map((c) => c[r] ?? ''));

  const range = (column: number, length: number) =>
    `${sheetReference(names.lists)}!$${columnLetters(column)}$2:$${columnLetters(column)}$${String(length + 1)}`;
  const fieldIndex = (field: string) => FIELD_DEFINITIONS.findIndex((d) => d.field === field);
  const validations: WriterValidation[] = [];
  const addList = (field: string, column: number, length: number) => {
    if (length > 0) {
      validations.push({
        column: fieldIndex(field),
        firstRow: 2,
        lastRow: LIST_ROWS,
        list: range(column, length),
      });
    }
  };
  addList('department', 0, lists.departments.length);
  addList('branch', 2, lists.branches.length);
  addList('primary_role', 4, roles.length);
  addList('language', 5, languages.length);

  const users: WriterSheet = {
    name: names.users,
    rightToLeft: rtl,
    freezeHeader: true,
    columns: FIELD_DEFINITIONS.map((d) => ({ width: d.width, format: d.format })),
    rows: [templateHeaders(locale)],
    validations,
  };
  const guideRows: string[][] = [[...text.header]];
  for (const d of FIELD_DEFINITIONS) {
    const first = locale === 'ar' ? d.header.ar : d.header.en;
    const second = locale === 'ar' ? d.header.en : d.header.ar;
    const descriptions =
      locale === 'ar' ? [d.description.ar, d.description.en] : [d.description.en, d.description.ar];
    guideRows.push([
      first,
      second,
      d.required ? text.required : text.optional,
      ...descriptions,
      d.example,
    ]);
  }
  guideRows.push([], [text.intro], [], ...text.never.map((line) => [line]));
  const guide: WriterSheet = {
    name: names.guide,
    rightToLeft: rtl,
    freezeHeader: true,
    columns: [
      { width: 26, format: 'wrap' },
      { width: 26, format: 'wrap' },
      { width: 10 },
      { width: 48, format: 'wrap' },
      { width: 48, format: 'wrap' },
      { width: 26, format: 'wrap' },
    ],
    rows: guideRows,
  };
  const listSheet: WriterSheet = {
    name: names.lists,
    rightToLeft: rtl,
    freezeHeader: true,
    columns: [
      { width: 28, format: 'text' },
      { width: 14, format: 'text' },
      { width: 24, format: 'text' },
      { width: 14, format: 'text' },
      { width: 24, format: 'text' },
      { width: 12, format: 'text' },
    ],
    rows: listRows,
  };
  return writeXlsx([users, guide, listSheet]);
}
