import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readCsvRows } from '../spreadsheet/csv';
import type { SheetRow } from '../spreadsheet/errors';
import { XlsxWorkbook } from '../spreadsheet/xlsx';
import { FIELD_DEFINITIONS, IMPORT_FIELDS, NEVER_IMPORTED } from './fields';
import {
  fieldForHeader,
  mappingProblems,
  neverImportedReason,
  proposedMapping,
  recognizeColumns,
} from './headers';
import { ISSUES, ISSUE_CODES, issue, issueMessage, parseIssues, severityOf } from './issues';
import { ReportBuilder, reportFileName } from './report';
import { IMPORTABLE_ROLES, isPrivilegedRole, roleForName, roleName, splitRoles } from './roles';
import { compactMobile, isEmail, isoDate, languageFor, normalizeRow } from './rows';
import { csvTemplate, templateFileName, templateHeaders, xlsxTemplate } from './template';
import { cleanText, excerpt, matchKey } from './text';

async function rowsOf(book: XlsxWorkbook, index: number): Promise<SheetRow[]> {
  const out: SheetRow[] = [];
  for await (const row of book.rows(index)) out.push(row);
  return out;
}

describe('text', () => {
  it('cleans cells like the forms do', () => {
    expect(cleanText('  نورة\u200F  \u202Bفهد\u202C ')).toBe('نورة فهد');
    expect(cleanText("'=A1")).toBe('=A1');
    expect(cleanText('\uFEFFx\u00ADy')).toBe('xy');
  });

  it('matches headers without case, punctuation, diacritics or letter variants', () => {
    expect(matchKey('الإيميل')).toBe(matchKey('الايميل'));
    expect(matchKey('اسم الأبُ')).toBe(matchKey('اسم الاب'));
    expect(matchKey('المسمى الوظيفى')).toBe(matchKey('المسمى الوظيفي'));
    expect(matchKey('E-Mail')).toBe('email');
    expect(matchKey("Father's Name (English)")).toBe('fathersnameenglish');
    expect(matchKey('القسم*')).toBe(matchKey('القسم'));
    expect(excerpt('abcdef', 4)).toBe('abc…');
    expect(excerpt('abc', 4)).toBe('abc');
  });
});

describe('fields and headers (screens 3 and 5)', () => {
  it('has the 20 fields of the database allow-list, each with both headers', () => {
    expect(FIELD_DEFINITIONS.map((d) => d.field)).toEqual([...IMPORT_FIELDS]);
    expect(IMPORT_FIELDS).toHaveLength(20);
    for (const d of FIELD_DEFINITIONS) {
      expect(fieldForHeader(d.header.ar), d.header.ar).toBe(d.field);
      expect(fieldForHeader(d.header.en), d.header.en).toBe(d.field);
      for (const synonym of d.synonyms) expect(fieldForHeader(synonym), synonym).toBe(d.field);
    }
  });

  it('recognizes common headers of HR systems', () => {
    expect(fieldForHeader('Email')).toBe('email');
    expect(fieldForHeader('الإيميل')).toBe('email');
    expect(fieldForHeader('E-mail')).toBe('email');
    expect(fieldForHeader('الإدارة')).toBe('department');
    expect(fieldForHeader('رقم الموظف')).toBe('employee_number');
    expect(fieldForHeader('Employee ID')).toBe('employee_number');
    expect(fieldForHeader('First Name')).toBe('first_name_en');
    expect(fieldForHeader('Last Name')).toBe('family_name_en');
    expect(fieldForHeader('العائلة')).toBe('family_name_ar');
    expect(fieldForHeader('المسمى')).toBe('job_title_ar');
    expect(fieldForHeader('الدور')).toBe('primary_role');
    expect(fieldForHeader('اللغة')).toBe('language');
    expect(fieldForHeader('المشرف')).toBeNull();
  });

  it('never imports status, passwords, restricted data or the report’s own columns', () => {
    expect(neverImportedReason('الحالة')).toBe('status');
    expect(neverImportedReason('Password')).toBe('password');
    expect(neverImportedReason('الجنسية')).toBe('restricted');
    expect(neverImportedReason('رقم الهوية')).toBe('restricted');
    expect(neverImportedReason('Date of birth')).toBe('restricted');
    expect(neverImportedReason('رمز السبب')).toBe('report');
    expect(neverImportedReason('Reason')).toBe('report');
    expect(neverImportedReason('القسم')).toBeNull();
    for (const headers of Object.values(NEVER_IMPORTED)) {
      for (const header of headers) expect(fieldForHeader(header), header).toBeNull();
    }
  });

  it('recognizes columns, suggests by values, never maps a field twice (screen 5)', () => {
    const columns = [
      { index: 0, header: 'Email', samples: ['n@alraya.example', 'k@alraya.example'] },
      { index: 1, header: 'الاسم الأول', samples: ['نورة', 'خالد'] },
      { index: 2, header: 'العائلة', samples: ['الدوسري'] },
      { index: 3, header: 'المشرف', samples: ['k@alraya.example', 'b@alraya.example'] },
      { index: 4, header: 'الجنسية', samples: [] },
      { index: 5, header: 'البريد', samples: ['x@y.test', 'z@y.test'] },
      { index: 6, header: 'تاريخ', samples: ['2024-03-03', '١٧/١١/٢٠١٩'] },
      { index: 7, header: 'رقم', samples: ['0551234567', '+966 55 123 4567'] },
      { index: 8, header: 'ملاحظات', samples: ['نص', 'آخر'] },
      { index: 9, header: 'X', samples: ['a@b.test'] },
    ];
    const recognized = recognizeColumns(columns);
    expect(recognized).toEqual([
      { kind: 'recognized', field: 'email' },
      { kind: 'recognized', field: 'first_name_ar' },
      { kind: 'recognized', field: 'family_name_ar' },
      { kind: 'suggested', field: 'manager_email', because: 'emails' },
      { kind: 'never', reason: 'restricted' },
      { kind: 'unknown' },
      { kind: 'suggested', field: 'hire_date', because: 'dates' },
      { kind: 'suggested', field: 'mobile', because: 'phones' },
      { kind: 'unknown' },
      { kind: 'unknown' },
    ]);
    expect(proposedMapping(recognized)).toEqual({
      '0': 'email',
      '1': 'first_name_ar',
      '2': 'family_name_ar',
    });
  });

  it('checks a chosen mapping', () => {
    const columns = [
      { index: 0, header: 'Email', samples: [] },
      { index: 1, header: 'الاسم', samples: [] },
      { index: 2, header: 'Status', samples: [] },
      { index: 3, header: 'العائلة', samples: [] },
    ];
    expect(
      mappingProblems({ '0': 'email', '1': 'first_name_ar', '3': 'family_name_ar' }, columns),
    ).toEqual([]);
    expect(
      mappingProblems(
        { '0': 'email', '1': 'email', '2': 'mobile', '9': 'branch', '3': 'status' },
        columns,
      ),
    ).toEqual([
      { kind: 'twice', field: 'email' },
      { kind: 'not_importable', column: 2 },
      { kind: 'not_importable', column: 3 },
      { kind: 'no_column', column: 9 },
      { kind: 'missing', field: 'first_name_ar' },
      { kind: 'missing', field: 'family_name_ar' },
    ]);
  });
});

describe('roles', () => {
  it('reads Arabic and English names and codes; only non-privileged roles are importable', () => {
    expect(roleForName('منسق التدريب')).toBe('training_coordinator');
    expect(roleForName('training coordinator')).toBe('training_coordinator');
    expect(roleForName('Mentor / Assessor')).toBe('mentor');
    expect(roleForName('مرشد/مقيم')).toBe('mentor');
    expect(roleForName('learner')).toBe('learner');
    expect(roleForName('منسق')).toBeNull();
    expect(isPrivilegedRole('hr_manager')).toBe(true);
    expect(isPrivilegedRole('learner')).toBe(false);
    expect(IMPORTABLE_ROLES.map((r) => r.code)).not.toContain('tenant_admin');
    expect(IMPORTABLE_ROLES.every((r) => !r.privileged)).toBe(true);
    expect(roleName('learner', 'ar')).toBe('متدرب');
    expect(roleName('nope', 'en')).toBe('nope');
    expect(splitRoles('متدرب، مدرب داخلي; Mentor / Assessor ,,')).toEqual([
      'متدرب',
      'مدرب داخلي',
      'Mentor / Assessor',
    ]);
  });
});

const FULL = {
  '0': 'email',
  '1': 'first_name_ar',
  '2': 'father_name_ar',
  '3': 'grandfather_name_ar',
  '4': 'family_name_ar',
  '5': 'first_name_en',
  '6': 'family_name_en',
  '7': 'mobile',
  '8': 'employee_number',
  '9': 'job_title_ar',
  '10': 'job_title_en',
  '11': 'department',
  '12': 'branch',
  '13': 'manager_email',
  '14': 'hire_date',
  '15': 'primary_role',
  '16': 'additional_roles',
  '17': 'language',
} as const;

describe('normalizeRow', () => {
  it('normalizes a good row', () => {
    const row = normalizeRow(
      5,
      [
        ' N.Aldossari@Alraya.Example ',
        'نورة',
        'فهد',
        '',
        'الدوسري',
        'Noura',
        'Aldossari',
        '+966 55 123 4567',
        'EMP-١٤٥٠',
        'أخصائية تدريب',
        'Training Specialist',
        'التدريب والتطوير',
        'فرع الرياض',
        'K.Alshehri@alraya.example',
        '٢٠٢٤/٣/٣',
        'منسق التدريب',
        'متدرب، مدرب داخلي',
        'English',
      ],
      FULL,
    );
    expect(row.issues).toEqual([]);
    expect(row.data).toEqual({
      email: 'n.aldossari@alraya.example',
      first_name_ar: 'نورة',
      father_name_ar: 'فهد',
      family_name_ar: 'الدوسري',
      first_name_en: 'Noura',
      family_name_en: 'Aldossari',
      mobile: '+966551234567',
      employee_number: 'EMP-1450',
      job_title_ar: 'أخصائية تدريب',
      job_title_en: 'Training Specialist',
      department: 'التدريب والتطوير',
      branch: 'فرع الرياض',
      manager_email: 'k.alshehri@alraya.example',
      hire_date: '2024-03-03',
      roles_given: true,
      primary_role: 'training_coordinator',
      additional_roles: ['learner', 'internal_instructor'],
      language: 'en',
    });
    expect(row.cells.email).toBe(' N.Aldossari@Alraya.Example ');
    expect(row.cells.grandfather_name_ar).toBeUndefined();
  });

  it('finds the format problems of the design’s catalogue', () => {
    const row = normalizeRow(
      7,
      [
        'ahmed.alqarni@alraya',
        '',
        'x'.repeat(61),
        '',
        '\u200F',
        '',
        '',
        '0551234567',
        'E'.repeat(41),
        'j'.repeat(151),
        '',
        '',
        '',
        'not-an-email',
        '03/03/2024',
        'مدير الموارد البشرية',
        'منسق، مدير المنشأة، متدرب، متدرب',
        'فرنسي',
      ],
      FULL,
    );
    expect(row.data).toEqual({ roles_given: true, additional_roles: ['learner'] });
    expect(row.issues.map((i) => `${i.c}:${i.s}:${i.f ?? ''}`)).toEqual([
      'EMAIL_INVALID:e:email',
      'NAME_AR_REQUIRED:e:first_name_ar',
      'NAME_TOO_LONG:e:father_name_ar',
      'NAME_AR_REQUIRED:e:family_name_ar',
      'MOBILE_NO_COUNTRY_CODE:w:mobile',
      'EMPLOYEE_NUMBER_INVALID:e:employee_number',
      'JOB_TITLE_TOO_LONG:w:job_title_ar',
      'MANAGER_EMAIL_INVALID:w:manager_email',
      'HIRE_DATE_INVALID:w:hire_date',
      'ROLE_PRIVILEGED:e:primary_role',
      'ROLE_UNKNOWN:e:additional_roles',
      'ROLE_ORG_ADMIN:e:additional_roles',
      'ROLE_REPEATED:i:additional_roles',
      'LANGUAGE_UNKNOWN:w:language',
    ]);
    expect(row.issues.find((i) => i.c === 'ROLE_PRIVILEGED')?.p).toEqual({ role: 'hr_manager' });
    expect(row.issues.find((i) => i.c === 'ROLE_UNKNOWN')?.p).toEqual({ name: 'منسق' });
  });

  it('requires the e-mail, checks the parts together and the mobile otherwise wrong', () => {
    const row = normalizeRow(
      2,
      ['', 'ا'.repeat(60), 'ب'.repeat(60), 'ج'.repeat(60), 'د'.repeat(60), '', '', '+12'],
      FULL,
    );
    expect(row.issues.map((i) => i.c)).toEqual([
      'EMAIL_REQUIRED',
      'FULL_NAME_TOO_LONG',
      'MOBILE_INVALID',
    ]);
  });

  it('helpers', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail(`${'a'.repeat(250)}@b.co`)).toBe(false);
    expect(compactMobile('00966 (55) 123-4567')).toBe('+966551234567');
    expect(isoDate('2024-02-29')).toBe('2024-02-29');
    expect(isoDate('2023-02-29')).toBeNull();
    expect(isoDate('1899-12-31')).toBeNull();
    expect(isoDate('2024-3-3')).toBe('2024-03-03');
    expect(languageFor('العربيه')).toBe('ar');
    expect(languageFor('AR')).toBe('ar');
    expect(languageFor('الإنجليزية')).toBe('en');
    expect(languageFor('fr')).toBeNull();
  });
});

describe('issues', () => {
  it('has a message in both languages for every code, and the codes the database writes', () => {
    for (const code of [
      'EMAIL_DUPLICATE_IN_FILE',
      'EMPLOYEE_NUMBER_DUPLICATE_IN_FILE',
      'OWN_ROW',
      'MEMBER_DEACTIVATED',
      'INVITATION_PENDING',
      'EMPLOYEE_NUMBER_TAKEN',
      'KEY_CONFLICT',
      'DEPARTMENT_AMBIGUOUS',
      'DEPARTMENT_NOT_FOUND',
      'BRANCH_AMBIGUOUS',
      'BRANCH_NOT_FOUND',
      'MANAGER_SELF',
      'MANAGER_LOOP',
      'MANAGER_NOT_FOUND',
      'ROLES_IGNORED_EXISTING',
      'CHANGED_SINCE_REVIEW',
      'NEW_SKIPPED_UPDATE_ONLY',
      'EXISTING_SKIPPED',
      'PRIVILEGED_MEMBER',
      'NO_CHANGES',
      'ROLE_ORG_ADMIN',
      'NOT_ALLOWED',
      'WRITE_FAILED',
      'NOT_PROCESSED',
    ]) {
      expect(ISSUE_CODES, code).toContain(code);
    }
    for (const code of ISSUE_CODES) {
      for (const locale of ['ar', 'en'] as const) {
        for (const phase of ['review', 'result'] as const) {
          const message = issueMessage({ c: code, s: severityOf(code) }, locale, phase);
          expect(message.length, `${code} ${locale}`).toBeGreaterThan(10);
        }
      }
    }
    expect(severityOf('UNKNOWN_CODE')).toBe('e');
    expect(issueMessage({ c: 'X_Y', s: 'e' }, 'en')).toContain('X_Y');
    expect(
      Object.values(ISSUES).every((entry) => ['e', 'w', 'k', 'i'].includes(entry.severity)),
    ).toBe(true);
  });

  it('writes the design’s sentences with their values', () => {
    expect(
      issueMessage(issue('EMAIL_DUPLICATE_IN_FILE', 'email', { rows: [14, 203], count: 2 }), 'ar'),
    ).toBe(
      'البريد نفسه مكرر في الصفين 14 و203. لا يُستورد أيٌّ منهما حتى يبقى صف واحد لهذا البريد.',
    );
    expect(
      issueMessage(issue('EMAIL_DUPLICATE_IN_FILE', 'email', { rows: [14, 203], count: 2 }), 'en'),
    ).toBe(
      'The same email is in rows 14 and 203. Neither is imported until the email appears once.',
    );
    expect(
      issueMessage(issue('EMAIL_DUPLICATE_IN_FILE', 'email', { rows: [1, 2, 3], count: 9 }), 'en'),
    ).toBe(
      'The same email is in rows 1, 2, 3 and others. None of them is imported until the email appears once.',
    );
    expect(
      issueMessage(
        issue('EMPLOYEE_NUMBER_DUPLICATE_IN_FILE', undefined, { rows: [88, 91, 92], count: 3 }),
        'ar',
      ),
    ).toBe('الرقم الوظيفي نفسه مكرر في الصفوف 88 و91 و92.');
    expect(issueMessage(issue('MANAGER_LOOP', 'manager_email', { rows: [518] }), 'ar')).toContain(
      'والصف 518',
    );
    expect(issueMessage(issue('MANAGER_LOOP', 'manager_email', { rows: [5, 6] }), 'en')).toContain(
      'rows 5 and 6',
    );
    expect(issueMessage(issue('MANAGER_LOOP', 'manager_email'), 'en')).toContain('too long');
    expect(
      issueMessage(issue('ROLE_PRIVILEGED', 'primary_role', { role: 'hr_manager' }), 'ar'),
    ).toBe(
      '«مدير الموارد البشرية» دور مميز، ولا يُسند بالاستيراد. يمكن إسناده من ملف المستخدم بعد إضافته.',
    );
    expect(issueMessage(issue('NAME_TOO_LONG', 'family_name_ar'), 'ar')).toBe(
      'اسم العائلة أطول من 60 حرفًا.',
    );
    expect(issueMessage(issue('NAME_AR_REQUIRED', 'family_name_ar'), 'en')).toContain(
      'family name',
    );
    expect(issueMessage(issue('FULL_NAME_TOO_LONG', 'first_name_en'), 'en')).toContain('English');
    expect(
      issueMessage(
        issue('CHANGED_SINCE_REVIEW', undefined, { reason: 'INVITATION_PENDING' }),
        'ar',
      ),
    ).toContain('دُعي');
    expect(
      issueMessage(
        issue('DEPARTMENT_NOT_FOUND', 'department', { name: 'التسويق الرقمي' }),
        'ar',
        'result',
      ),
    ).toBe('القسم «التسويق الرقمي» غير موجود، فأُضيف الشخص دون قسم.');
    expect(issueMessage(issue('TEXT_TOO_LONG', 'branch'), 'en')).toContain('Branch');
    expect(issueMessage(issue('TEXT_TOO_LONG', 'nothing' as never), 'ar')).toContain('القيمة');
  });

  it('parses stored issues defensively', () => {
    expect(
      parseIssues([
        { c: 'A', s: 'e', f: 'email', p: { x: 1 } },
        { c: 'B', s: 'w' },
        { c: 'C', s: 'z' },
        null,
        { s: 'e' },
        { c: 'D', s: 'k', p: [1] },
      ]),
    ).toEqual([
      { c: 'A', s: 'e', f: 'email', p: { x: 1 } },
      { c: 'B', s: 'w' },
      { c: 'D', s: 'k' },
    ]);
    expect(parseIssues('x')).toEqual([]);
    expect(issue('EMAIL_REQUIRED')).toEqual({ c: 'EMAIL_REQUIRED', s: 'e' });
  });
});

describe('template (screen 3)', () => {
  it('CSV: header row only, UTF-8 with BOM', async () => {
    const bytes = csvTemplate('ar');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = [];
    for await (const row of readCsvRows([bytes])) rows.push(row);
    expect(rows).toEqual([{ number: 1, cells: templateHeaders('ar') }]);
    expect(templateHeaders('en')[0]).toBe('Work email');
    expect(templateFileName('ar', 'xlsx')).toBe('قالب-استيراد-المستخدمين.xlsx');
    expect(templateFileName('en', 'csv')).toBe('user-import-template.csv');
  });

  it('XLSX: users, instructions and lists sheets; headers recognized back', async () => {
    const bytes = xlsxTemplate('ar', {
      departments: [
        { code: 'TRN', nameAr: 'التدريب والتطوير', nameEn: 'Training' },
        { code: null, nameAr: '=خطر', nameEn: null },
      ],
      branches: [{ code: 'RUH', nameAr: 'فرع الرياض', nameEn: 'Riyadh' }],
    });
    const book = XlsxWorkbook.open(bytes);
    expect(book.sheets.map((s) => s.name)).toEqual(['المستخدمون', 'تعليمات', 'القوائم']);
    const [header] = await rowsOf(book, 0);
    expect(header?.cells).toEqual(templateHeaders('ar'));
    expect(header?.cells.map((h) => fieldForHeader(h))).toEqual([...IMPORT_FIELDS]);
    expect(await rowsOf(book, 0)).toHaveLength(1);
    const lists = (await rowsOf(book, 2)).map((r) => r.cells);
    expect(lists[0]).toEqual(['القسم', 'رمز القسم', 'الفرع', 'رمز الفرع', 'الدور', 'اللغة']);
    expect(lists[1]?.slice(0, 5)).toEqual([
      'التدريب والتطوير',
      'TRN',
      'فرع الرياض',
      'RUH',
      IMPORTABLE_ROLES[0]?.name.ar,
    ]);
    expect(lists[2]?.[0]).toBe('=خطر');
    expect(
      lists
        .slice(1)
        .map((r) => r[4])
        .filter(Boolean),
    ).toHaveLength(IMPORTABLE_ROLES.length);
    const guide = (await rowsOf(book, 1)).map((r) => r.cells);
    expect(guide[1]?.[0]).toBe('البريد الإلكتروني للعمل');
    expect(guide[1]?.[2]).toBe('مطلوب');
    const english = XlsxWorkbook.open(xlsxTemplate('en', { departments: [], branches: [] }));
    expect(english.sheets.map((s) => s.name)).toEqual(['Users', 'Instructions', 'Lists']);
    expect((await rowsOf(english, 0))[0]?.cells[0]).toBe('Work email');
  });
});

describe('report (screen 11)', () => {
  it('writes an XLSX of plain text: our five columns, then the file’s columns; recognized back as ignored', async () => {
    const builder = new ReportBuilder(
      'ar',
      [
        { field: 'email', header: 'Email' },
        { field: 'family_name_ar', header: 'العائلة' },
      ],
      'result',
    );
    builder.add({
      rowNumber: 14,
      outcome: 'not_imported',
      issues: [issue('EMAIL_DUPLICATE_IN_FILE', 'email', { rows: [14, 203], count: 2 })],
      cells: { email: 'n.alharbi@alraya.example', family_name_ar: 'الحربي' },
    });
    builder.add({
      rowNumber: 655,
      outcome: 'not_imported',
      issues: [
        issue('NAME_TOO_LONG', 'family_name_ar'),
        issue('MOBILE_INVALID', 'mobile', { value: '1' }),
      ],
      cells: { email: 'w@x.test', family_name_ar: '=HYPERLINK("https://x.test")' },
    });
    expect(builder.rows).toBe(2);
    const bytes = builder.bytes();
    const book = XlsxWorkbook.open(bytes);
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(['تقرير الأخطاء']);
    const rows = await rowsOf(book, 0);
    expect(rows[0]?.cells).toEqual([
      'الصف في الملف',
      'النتيجة',
      'السبب',
      'Reason',
      'رمز السبب',
      'Email',
      'العائلة',
    ]);
    expect(rows[1]?.cells.slice(0, 2)).toEqual(['14', 'لم يُستورد']);
    expect(rows[1]?.cells[4]).toBe('EMAIL_DUPLICATE_IN_FILE');
    expect(rows[2]?.cells[4]).toBe('NAME_TOO_LONG MOBILE_INVALID');
    expect(rows[2]?.cells[2]).toContain(' · ');
    // Security review L2: the value exactly as it was, as an inline string — never a formula cell.
    expect(rows[2]?.cells[6]).toBe('=HYPERLINK("https://x.test")');
    const sheet = new TextDecoder().decode(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).not.toContain('<f>');
    expect(sheet).not.toContain('<f ');
    expect(sheet).toContain('rightToLeft="1"');
    // Uploaded again: our five columns are never imported; the file's columns are recognized.
    const recognized = recognizeColumns(
      (rows[0]?.cells ?? []).map((header, index) => ({ index, header, samples: [] })),
    );
    expect(recognized.slice(0, 5).every((r) => r.kind === 'never')).toBe(true);
    expect(recognized.slice(5)).toEqual([
      { kind: 'recognized', field: 'email' },
      { kind: 'recognized', field: 'family_name_ar' },
    ]);
    expect(reportFileName('موظفو-الراية.csv', 'ar', 'result')).toBe(
      'تقرير-الأخطاء-موظفو-الراية.xlsx',
    );
    expect(reportFileName('staff', 'en', 'review')).toBe('problems-staff.xlsx');
    const english = new ReportBuilder('en', [], 'review');
    english.add({ rowNumber: 2, outcome: 'will_skip', issues: [], cells: {} });
    const englishBook = XlsxWorkbook.open(english.bytes());
    expect(englishBook.sheets.map((s) => s.name)).toEqual(['Problems']);
    expect((await rowsOf(englishBook, 0))[0]?.cells).toEqual([
      'Row in file',
      'Result',
      'السبب',
      'Reason',
      'Reason code',
    ]);
    expect(
      new TextDecoder().decode(unzipSync(english.bytes())['xl/worksheets/sheet1.xml']),
    ).not.toContain('rightToLeft');
  });
});
