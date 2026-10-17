import { type ImportField, fieldDefinition, isImportField } from './fields';
import { roleName } from './roles';

/**
 * What the import says about a row (T-M2-12; design README §6 «Message catalogue», screens 6, 10, 11).
 * Stored on the staged row as `{c: code, s: severity, f: field, p: params}` (the database's own checks
 * add theirs in the same form). Severities: e error (not imported), w warning (imported, the value left
 * empty), k skipped (deliberately not changed), i information (review only). Messages are full sentences
 * (what happened → what to do); codes are fixed and the same in both languages (support uses them).
 */
export type Severity = 'e' | 'w' | 'k' | 'i';

export interface ImportIssue {
  readonly c: string;
  readonly s: Severity;
  readonly f?: string;
  readonly p?: Readonly<Record<string, unknown>>;
}

export type Locale = 'ar' | 'en';
/** The review (before anything is saved) or the result (what happened). */
export type Phase = 'review' | 'result';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const rowsOf = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number').slice(0, 6) : [];

/** «14 و203» / «14 و203 و310»; "14 and 203" / "14, 203 and 310"; with «…» when there are more. */
function rowList(rows: readonly number[], count: number, locale: Locale): string {
  const items = rows.map(String);
  const more = count > items.length;
  if (locale === 'ar') return `${items.join(' و')}${more ? ' وغيرها' : ''}`;
  if (items.length <= 1) return `${items.join('')}${more ? ' and others' : ''}`;
  if (more) return `${items.join(', ')} and others`;
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

function fieldLabel(field: string | undefined, locale: Locale): string {
  if (field === undefined || !isImportField(field)) return locale === 'ar' ? 'القيمة' : 'The value';
  return fieldDefinition(field).header[locale];
}

type Message = (issue: ImportIssue, locale: Locale) => string;
type Catalogue = Readonly<
  Record<string, { readonly severity: Severity; review: Message; result?: Message }>
>;

const both =
  (ar: string, en: string): Message =>
  (_issue, locale) =>
    locale === 'ar' ? ar : en;

const CHANGED_SINCE_REVIEW: Readonly<Record<string, readonly [string, string]>> = {
  EMAIL_TAKEN: [
    'أُضيف شخص بهذا البريد منذ المراجعة، فلم يُستورد الصف.',
    'Someone with this email was added since the review, so the row wasn’t imported.',
  ],
  INVITATION_PENDING: [
    'دُعي هذا الشخص منذ المراجعة، فلم يُستورد الصف.',
    'This person was invited since the review, so the row wasn’t imported.',
  ],
  MEMBER_DEACTIVATED: [
    'عُطّل حساب هذا الشخص منذ المراجعة، فلم يتغير.',
    'This person’s account was deactivated since the review; nothing changed.',
  ],
  EMPLOYEE_NUMBER_TAKEN: [
    'سُجّل هذا الرقم الوظيفي لشخص آخر منذ المراجعة، فلم يُستورد الصف.',
    'This employee number was given to someone else since the review, so the row wasn’t imported.',
  ],
};

export const ISSUES: Catalogue = {
  // Errors: the row is not imported.
  EMAIL_REQUIRED: {
    severity: 'e',
    review: both(
      'البريد الإلكتروني للعمل فارغ، وهو مطلوب.',
      'The work email is empty; it’s required.',
    ),
  },
  EMAIL_INVALID: {
    severity: 'e',
    review: both(
      'البريد الإلكتروني غير مكتمل. يتكون من اسم ثم @ ثم النطاق، مثل name@example.com.',
      'The email address is incomplete. It looks like name@example.com.',
    ),
  },
  NAME_AR_REQUIRED: {
    severity: 'e',
    review: (issue, locale) =>
      issue.f === 'family_name_ar'
        ? locale === 'ar'
          ? 'اسم العائلة بالعربية فارغ، وهو مطلوب.'
          : 'The Arabic family name is empty; it’s required.'
        : locale === 'ar'
          ? 'الاسم الأول بالعربية فارغ، وهو مطلوب.'
          : 'The Arabic first name is empty; it’s required.',
  },
  NAME_EN_REQUIRED: {
    severity: 'e',
    review: (issue, locale) =>
      issue.f === 'family_name_en'
        ? locale === 'ar'
          ? 'اسم العائلة بالإنجليزية فارغ، وهو مطلوب.'
          : 'The English family name is empty; it’s required.'
        : locale === 'ar'
          ? 'الاسم الأول بالإنجليزية فارغ، وهو مطلوب.'
          : 'The English first name is empty; it’s required.',
  },
  NAME_TOO_LONG: {
    severity: 'e',
    review: (issue, locale) =>
      locale === 'ar'
        ? `${fieldLabel(issue.f, locale)} أطول من 60 حرفًا.`
        : `${fieldLabel(issue.f, locale)} is longer than 60 characters.`,
  },
  FULL_NAME_TOO_LONG: {
    severity: 'e',
    review: (issue, locale) =>
      issue.f?.endsWith('_en')
        ? locale === 'ar'
          ? 'أجزاء الاسم بالإنجليزية معًا أطول من 200 حرف.'
          : 'The English name parts together are longer than 200 characters.'
        : locale === 'ar'
          ? 'أجزاء الاسم بالعربية معًا أطول من 200 حرف.'
          : 'The Arabic name parts together are longer than 200 characters.',
  },
  EMAIL_DUPLICATE_IN_FILE: {
    severity: 'e',
    review: (issue, locale) => {
      const rows = rowsOf(issue.p?.rows);
      const count = Number(issue.p?.count ?? rows.length);
      if (locale === 'ar') {
        return count <= 2
          ? `البريد نفسه مكرر في الصفين ${rowList(rows, count, locale)}. لا يُستورد أيٌّ منهما حتى يبقى صف واحد لهذا البريد.`
          : `البريد نفسه مكرر في الصفوف ${rowList(rows, count, locale)}. لا يُستورد أيٌّ منها حتى يبقى صف واحد لهذا البريد.`;
      }
      return `The same email is in rows ${rowList(rows, count, locale)}. ${count <= 2 ? 'Neither' : 'None of them'} is imported until the email appears once.`;
    },
  },
  EMPLOYEE_NUMBER_DUPLICATE_IN_FILE: {
    severity: 'e',
    review: (issue, locale) => {
      const rows = rowsOf(issue.p?.rows);
      const count = Number(issue.p?.count ?? rows.length);
      if (locale === 'ar') {
        return count <= 2
          ? `الرقم الوظيفي نفسه مكرر في الصفين ${rowList(rows, count, locale)}.`
          : `الرقم الوظيفي نفسه مكرر في الصفوف ${rowList(rows, count, locale)}.`;
      }
      return `The same employee number is in rows ${rowList(rows, count, locale)}.`;
    },
  },
  EMPLOYEE_NUMBER_TAKEN: {
    severity: 'e',
    review: (issue, locale) =>
      locale === 'ar'
        ? `الرقم الوظيفي ${text(issue.p?.number)} مسجّل لشخص آخر في المنشأة.`
        : `Employee number ${text(issue.p?.number)} belongs to someone else in the organization.`,
  },
  EMPLOYEE_NUMBER_INVALID: {
    severity: 'e',
    review: both(
      'الرقم الوظيفي أطول من 40 حرفًا.',
      'The employee number is longer than 40 characters.',
    ),
  },
  KEY_CONFLICT: {
    severity: 'e',
    review: both(
      'البريد مسجّل لشخص، والرقم الوظيفي مسجّل لشخص آخر. لا يتغير أيٌّ منهما حتى تتطابق البيانات.',
      'The email belongs to one person and the employee number to another. Neither is changed until they match.',
    ),
  },
  ROLE_UNKNOWN: {
    severity: 'e',
    review: (issue, locale) =>
      locale === 'ar'
        ? `الدور «${text(issue.p?.name)}» غير معروف. يمكنك كتابة اسم الدور كما في ورقة «القوائم» في القالب، مثل «منسق التدريب».`
        : `Role “${text(issue.p?.name)}” isn’t recognized. Write the role as on the Lists sheet, for example “Training Coordinator”.`,
  },
  ROLE_PRIVILEGED: {
    severity: 'e',
    review: (issue, locale) => {
      const name = roleName(text(issue.p?.role), locale);
      return locale === 'ar'
        ? `«${name}» دور مميز، ولا يُسند بالاستيراد. يمكن إسناده من ملف المستخدم بعد إضافته.`
        : `“${name}” is a privileged role and can’t be given by import. Give it from the user’s profile after the import.`;
    },
  },
  ROLE_ORG_ADMIN: {
    severity: 'e',
    review: both(
      'لا يُسند دور «مدير المنظمة» بالاستيراد. يُسند من ملف المستخدم، ويكون الدور الوحيد لصاحبه.',
      'The Organization Admin role can’t be given by import. It’s given from the user’s profile and is the person’s only role.',
    ),
  },
  MANAGER_LOOP: {
    severity: 'e',
    review: (issue, locale) => {
      const rows = rowsOf(issue.p?.rows);
      if (rows.length === 0) {
        return locale === 'ar'
          ? 'يقع هذا الصف في حلقة أو في تسلسل إداري أطول من المسموح داخل الملف. لا يُستورد حتى تُصحَّح.'
          : 'This row is part of a loop, or of a reporting line too long, in the file. It isn’t imported until it’s fixed.';
      }
      if (rows.length === 1) {
        return locale === 'ar'
          ? `هذا الصف والصف ${String(rows[0])} يجعلان كلًّا من الشخصين مديرًا للآخر، فتنشأ حلقة في التسلسل الإداري. لا يُستورد أيٌّ منهما حتى تُصحَّح.`
          : `This row and row ${String(rows[0])} make each person the other’s manager, a loop in the reporting line. Neither is imported until it’s fixed.`;
      }
      return locale === 'ar'
        ? `هذا الصف والصفوف ${rowList(rows, rows.length, locale)} تُنشئ حلقة في التسلسل الإداري. لا يُستورد أيٌّ منها حتى تُصحَّح.`
        : `This row and rows ${rowList(rows, rows.length, locale)} form a loop in the reporting line. None of them is imported until it’s fixed.`;
    },
  },
  MANAGER_SELF: {
    severity: 'e',
    review: both('لا يمكن أن يكون الشخص مديرًا لنفسه.', 'A person can’t be their own manager.'),
  },
  CHANGED_SINCE_REVIEW: {
    severity: 'e',
    review: (issue, locale) => {
      const pair = CHANGED_SINCE_REVIEW[text(issue.p?.reason)];
      if (pair) return locale === 'ar' ? pair[0] : pair[1];
      return locale === 'ar'
        ? 'تغيّرت بيانات المنشأة منذ المراجعة، فلم يُستورد هذا الصف. يمكنك استيراده من جديد.'
        : 'The organization’s data changed since the review, so this row wasn’t imported. You can import it again.';
    },
  },
  NOT_PROCESSED: {
    severity: 'e',
    review: both(
      'توقف الاستيراد قبل أن يصل إلى هذا الصف. يمكنك استيراده من جديد.',
      'The import stopped before it reached this row. You can import it again.',
    ),
  },
  NOT_ALLOWED: {
    severity: 'e',
    review: both(
      'لم تعد لديك صلاحية إضافة هذا الشخص، فلم يُستورد.',
      'You may no longer add this person, so the row wasn’t imported.',
    ),
  },
  WRITE_FAILED: {
    severity: 'e',
    review: both(
      'تعذّر حفظ هذا الصف بسبب خلل لدينا. يمكنك استيراده من جديد.',
      'We couldn’t save this row because of a fault on our side. You can import it again.',
    ),
  },

  // Warnings: the row is imported; one optional value is left empty.
  DEPARTMENT_NOT_FOUND: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `القسم «${text(issue.p?.name)}» غير موجود في بيانات المنشأة. يُضاف الشخص دون قسم، ويمكن تحديده لاحقًا.`
        : `Department “${text(issue.p?.name)}” isn’t in Organization data. The person is added without a department.`,
    result: (issue, locale) =>
      locale === 'ar'
        ? `القسم «${text(issue.p?.name)}» غير موجود، فأُضيف الشخص دون قسم.`
        : `Department “${text(issue.p?.name)}” was not found; added without a department.`,
  },
  DEPARTMENT_AMBIGUOUS: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `يوجد أكثر من قسم باسم «${text(issue.p?.name)}». يُضاف الشخص دون قسم؛ يمكنك كتابة رمز القسم بدلًا من اسمه.`
        : `More than one department is called “${text(issue.p?.name)}”. The person is added without a department; use the department code instead.`,
  },
  BRANCH_NOT_FOUND: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `الفرع «${text(issue.p?.name)}» غير موجود في بيانات المنشأة. يُضاف الشخص دون فرع.`
        : `Branch “${text(issue.p?.name)}” isn’t in Organization data. The person is added without a branch.`,
    result: (issue, locale) =>
      locale === 'ar'
        ? `الفرع «${text(issue.p?.name)}» غير موجود، فأُضيف الشخص دون فرع.`
        : `Branch “${text(issue.p?.name)}” was not found; added without a branch.`,
  },
  BRANCH_AMBIGUOUS: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `يوجد أكثر من فرع باسم «${text(issue.p?.name)}». يُضاف الشخص دون فرع؛ يمكنك كتابة رمز الفرع بدلًا من اسمه.`
        : `More than one branch is called “${text(issue.p?.name)}”. The person is added without a branch; use the branch code instead.`,
  },
  MANAGER_NOT_FOUND: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `لا يوجد مستخدم نشط بالبريد ${text(issue.p?.email)}، ولا يرد في الملف. يُضاف الشخص دون مدير مباشر.`
        : `No active user has the email ${text(issue.p?.email)} and it isn’t in the file. The person is added without a direct manager.`,
  },
  MANAGER_EMAIL_INVALID: {
    severity: 'w',
    review: both(
      'بريد المدير المباشر غير مكتمل، فيُضاف الشخص دون مدير مباشر.',
      'The direct manager’s email is incomplete, so the person is added without a direct manager.',
    ),
  },
  MOBILE_NO_COUNTRY_CODE: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `رقم الجوال ${text(issue.p?.value)} بلا رمز الدولة، فيُضاف الشخص دون رقم جوال. يُكتب الرقم مثل \u200E+966551234567\u200E.`
        : `Mobile ${text(issue.p?.value)} has no country code, so the person is added without a mobile. Write it like +966551234567.`,
  },
  MOBILE_INVALID: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `رقم الجوال ${text(issue.p?.value)} غير صحيح، فيُضاف الشخص دون رقم جوال. يُكتب الرقم مثل \u200E+966551234567\u200E.`
        : `Mobile ${text(issue.p?.value)} isn’t valid, so the person is added without a mobile. Write it like +966551234567.`,
  },
  HIRE_DATE_INVALID: {
    severity: 'w',
    review: both(
      'تاريخ التعيين غير مفهوم، فيُضاف الشخص دونه. يُكتب بالتاريخ الميلادي مثل 2024-03-03.',
      'The hire date can’t be read, so the person is added without it. Write it like 2024-03-03.',
    ),
  },
  LANGUAGE_UNKNOWN: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `اللغة «${text(issue.p?.value)}» غير متاحة، فتُستخدم لغة المنشأة.`
        : `Language “${text(issue.p?.value)}” isn’t available, so the organization’s language is used.`,
  },
  JOB_TITLE_TOO_LONG: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `${fieldLabel(issue.f, locale)} أطول من 150 حرفًا، فيُضاف الشخص دونه.`
        : `${fieldLabel(issue.f, locale)} is longer than 150 characters, so the person is added without it.`,
  },
  TEXT_TOO_LONG: {
    severity: 'w',
    review: (issue, locale) =>
      locale === 'ar'
        ? `قيمة «${fieldLabel(issue.f, locale)}» أطول من المسموح، فلم تُقرأ.`
        : `The value of “${fieldLabel(issue.f, locale)}” is too long, so it wasn’t read.`,
  },
  ROLES_IGNORED_EXISTING: {
    severity: 'w',
    review: both(
      'لا تتغير أدوار المستخدمين الموجودين بالاستيراد، فلم يُقرأ عمود الدور في هذا الصف.',
      'Roles of existing users aren’t changed by import; the role column was ignored for this row.',
    ),
  },

  // Skipped: deliberately not changed.
  EXISTING_SKIPPED: {
    severity: 'k',
    review: both(
      'مستخدم موجود من قبل، واختير تخطي الموجودين.',
      'Already a user; existing users were skipped.',
    ),
  },
  INVITATION_PENDING: {
    severity: 'k',
    review: both(
      'لهذا الشخص دعوة لم تُقبل بعد، فلن يتغير.',
      'This person has an invitation not accepted yet; nothing changes.',
    ),
    result: both(
      'لهذا الشخص دعوة لم تُقبل بعد، فلم يتغير.',
      'This person has an invitation not accepted yet; nothing changed.',
    ),
  },
  MEMBER_DEACTIVATED: {
    severity: 'k',
    review: both(
      'حساب هذا الشخص معطّل، فلن يتغير. يمكن إعادة تفعيله من ملفه.',
      'This person’s account is deactivated; nothing changes. It can be reactivated from the profile.',
    ),
    result: both(
      'حساب هذا الشخص معطّل، فلم يتغير.',
      'This person’s account is deactivated; nothing changed.',
    ),
  },
  OWN_ROW: {
    severity: 'k',
    review: both(
      'هذه بياناتك أنت، ولا تتغير بالاستيراد.',
      'This is your own record; imports don’t change it.',
    ),
  },
  PRIVILEGED_MEMBER: {
    severity: 'k',
    review: both(
      'لهذا الشخص دور مميز، فيغيّر بياناته مدير المنظمة من ملفه.',
      'This person holds a privileged role; the Organization Admin changes their data from the profile.',
    ),
  },
  NEW_SKIPPED_UPDATE_ONLY: {
    severity: 'k',
    review: both(
      'ليس مستخدمًا بعد، واختير تحديث بيانات الموجودين فقط.',
      'Not a user yet; only existing users were updated.',
    ),
  },
  NO_CHANGES: {
    severity: 'k',
    review: both(
      'لا يختلف شيء في الملف عن بيانات هذا المستخدم.',
      'Nothing in the file differs from this user’s data.',
    ),
  },

  // One role per person (EP-ROLES, PO 17 Oct 2026): the file's additional roles are not given.
  ROLES_ONE_PER_PERSON: {
    severity: 'w',
    review: both(
      'لكل شخص دور واحد، فتُتجاهل الأدوار الإضافية ويُسند الدور الأساسي فقط.',
      'Each person has one role: the additional roles are ignored and only the primary role is given.',
    ),
  },

  // Information (review only).
  ROLE_REPEATED: {
    severity: 'i',
    review: (issue, locale) =>
      locale === 'ar'
        ? `تكرر الدور «${text(issue.p?.name)}» في هذا الصف، فأُخذ مرة واحدة.`
        : `Role “${text(issue.p?.name)}” is repeated in this row; it counts once.`,
  },
};

export const ISSUE_CODES = Object.keys(ISSUES);

/** The severity of a code (unknown codes: errors — never imported silently). */
export function severityOf(code: string): Severity {
  return ISSUES[code]?.severity ?? 'e';
}

/** The message of an issue, in the language asked (unknown codes: a generic message with the code). */
export function issueMessage(issue: ImportIssue, locale: Locale, phase: Phase = 'review'): string {
  const entry = ISSUES[issue.c];
  if (!entry) {
    return locale === 'ar'
      ? `لم يُستورد هذا الصف (${issue.c}).`
      : `This row wasn’t imported (${issue.c}).`;
  }
  return (phase === 'result' && entry.result ? entry.result : entry.review)(issue, locale);
}

/** An issue as stored: params without empty values. */
export function issue(
  code: string,
  field?: ImportField,
  params?: Readonly<Record<string, unknown>>,
): ImportIssue {
  const severity = severityOf(code);
  return {
    c: code,
    s: severity,
    ...(field === undefined ? {} : { f: field }),
    ...(params === undefined || Object.keys(params).length === 0 ? {} : { p: params }),
  };
}

/** Reads issues from the database's JSON (anything malformed is dropped). */
export function parseIssues(value: unknown): ImportIssue[] {
  if (!Array.isArray(value)) return [];
  const out: ImportIssue[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const { c, s, f, p } = item as Record<string, unknown>;
    if (typeof c !== 'string' || (s !== 'e' && s !== 'w' && s !== 'k' && s !== 'i')) continue;
    out.push({
      c,
      s,
      ...(typeof f === 'string' ? { f } : {}),
      ...(typeof p === 'object' && p !== null && !Array.isArray(p)
        ? { p: p as Record<string, unknown> }
        : {}),
    });
  }
  return out;
}
