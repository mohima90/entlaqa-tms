import { normalizeDigits } from '@jadarat/platform-i18n/text';
import {
  COURSE_CODE_RE,
  COURSE_DEFAULTS,
  COURSE_LIMITS,
  COURSE_STATUSES,
  type CourseCategoryRow,
  type CourseFilter,
  type CourseRow,
  DELIVERY_TYPES,
  type DeliveryType,
  courseFieldProblems,
} from '@jadarat/tms/courses';

/**
 * Courses page helpers (T-M3-03) — client-safe: the list's URL parameters, the preview data shown without
 * a database, «Add course» (the popup's four fields) and the course's settings form (raw text fields → the
 * values the action validates again).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The list's filters as the query string carries them (untrusted; the query validates them again). */
export interface CoursesParams {
  readonly q?: string;
  readonly category?: string;
  readonly type?: string;
  readonly status?: string;
}

const first = (value: string | string[] | undefined): string | undefined => {
  const text = (Array.isArray(value) ? value[0] : value)?.trim();
  return text === '' ? undefined : text;
};

export function coursesParams(raw: Record<string, string | string[] | undefined>): CoursesParams {
  const params: Record<string, string> = {};
  for (const key of ['q', 'category', 'type', 'status'] as const) {
    const value = first(raw[key]);
    if (value !== undefined) params[key] = value.slice(0, 120);
  }
  return params;
}

/** The filters the preview applies (well-formed values only, as the query would accept them). */
export function previewFilter(params: CoursesParams): CourseFilter {
  return {
    q: params.q,
    category:
      params.category === 'none' || (params.category && UUID_RE.test(params.category))
        ? params.category
        : undefined,
    type: (DELIVERY_TYPES as readonly string[]).includes(params.type ?? '')
      ? (params.type as DeliveryType)
      : undefined,
    status: (COURSE_STATUSES as readonly string[]).includes(params.status ?? '')
      ? (params.status as CourseFilter['status'])
      : undefined,
  };
}

/** The locale-less path of the list with its filters (the language switch keeps them). */
export function coursesPath(params: CoursesParams): string {
  const query = new URLSearchParams();
  for (const key of ['q', 'category', 'type', 'status'] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return `/suite/courses${text ? `?${text}` : ''}`;
}

export function coursesHref(locale: string, params: CoursesParams): string {
  return `/${locale}${coursesPath(params)}`;
}

/** The sections of a course's settings page (WP-UX-01 c): the tabs at its side, in order. */
export const COURSE_SETTINGS_TABS = ['about', 'delivery', 'capacity'] as const;
export type CourseSettingsTab = (typeof COURSE_SETTINGS_TABS)[number];

/** The section `?tab=` names (untrusted), else the first one. */
export function courseSettingsTab(value: unknown): CourseSettingsTab {
  return (COURSE_SETTINGS_TABS as readonly unknown[]).includes(value)
    ? (value as CourseSettingsTab)
    : 'about';
}

/** The locale-less path of a course's settings page, on one of its sections (each its own address). */
export function courseSettingsPath(courseId: string, tab?: CourseSettingsTab): string {
  return `/suite/courses/${courseId}/settings${tab && tab !== 'about' ? `?tab=${tab}` : ''}`;
}

export function courseSettingsHref(
  locale: string,
  courseId: string,
  tab?: CourseSettingsTab,
): string {
  return `/${locale}${courseSettingsPath(courseId, tab)}`;
}

export function isFiltered(params: CoursesParams): boolean {
  return Boolean(params.q ?? params.category ?? params.type ?? params.status);
}

/** Example data for the page without a database (local development, CI): never stored anywhere. */
export const PREVIEW_CATEGORIES: readonly CourseCategoryRow[] = [
  { id: '00000000-0000-4000-8000-00000000ca01', nameEn: 'Leadership', nameAr: 'القيادة' },
  {
    id: '00000000-0000-4000-8000-00000000ca02',
    nameEn: 'Health and safety',
    nameAr: 'الصحة والسلامة',
  },
];

const previewCourse = (over: Partial<CourseRow> & Pick<CourseRow, 'id' | 'code'>): CourseRow => ({
  titleEn: '',
  titleAr: '',
  descriptionEn: null,
  descriptionAr: null,
  categoryId: null,
  deliveryType: 'classroom',
  durationHours: 6,
  durationDays: 1,
  minParticipants: 5,
  maxParticipants: 20,
  estCostPerSession: null,
  estCostPerParticipant: null,
  costCurrency: null,
  status: 'active',
  version: 1,
  ...over,
});

export const PREVIEW_COURSES: readonly CourseRow[] = [
  previewCourse({
    id: '00000000-0000-4000-8000-00000000c001',
    code: 'LEAD-101',
    titleEn: 'Strategic management',
    titleAr: 'الإدارة الاستراتيجية',
    descriptionEn: 'Setting direction and turning strategy into plans.',
    descriptionAr: 'تحديد التوجه وتحويل الاستراتيجية إلى خطط.',
    categoryId: '00000000-0000-4000-8000-00000000ca01',
    durationHours: 12,
    durationDays: 2,
    minParticipants: 8,
    maxParticipants: 20,
    estCostPerSession: 15000,
    estCostPerParticipant: 250,
    costCurrency: 'SAR',
  }),
  previewCourse({
    id: '00000000-0000-4000-8000-00000000c002',
    code: 'HSE-200',
    titleEn: 'Fire safety and evacuation',
    titleAr: 'السلامة من الحرائق والإخلاء',
    categoryId: '00000000-0000-4000-8000-00000000ca02',
    deliveryType: 'on_the_job',
    durationHours: 4,
    durationDays: null,
    minParticipants: 6,
    maxParticipants: 12,
    estCostPerSession: 3500,
    costCurrency: 'SAR',
  }),
  previewCourse({
    id: '00000000-0000-4000-8000-00000000c003',
    code: 'DATA-110',
    titleEn: 'Data literacy for managers',
    titleAr: 'الثقافة الرقمية للمديرين',
    deliveryType: 'virtual',
    durationHours: 3,
    durationDays: null,
    minParticipants: 10,
    maxParticipants: 40,
  }),
  previewCourse({
    id: '00000000-0000-4000-8000-00000000c004',
    code: 'OLD-001',
    titleEn: 'Office software basics',
    titleAr: 'أساسيات البرامج المكتبية',
    deliveryType: 'elearning',
    durationHours: 2,
    durationDays: null,
    minParticipants: 1,
    maxParticipants: 100,
    status: 'archived',
  }),
];

// ---------------------------------------------------------------------------------------------------
// The add / edit form
// ---------------------------------------------------------------------------------------------------

/** What the form holds: text as typed. `category` is '', a category id, or 'new'. */
export interface CourseFormState {
  readonly code: string;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly descriptionEn: string;
  readonly descriptionAr: string;
  readonly category: string;
  readonly newCategoryEn: string;
  readonly newCategoryAr: string;
  readonly deliveryType: string;
  readonly durationHours: string;
  readonly durationDays: string;
  readonly minParticipants: string;
  readonly maxParticipants: string;
  readonly estCostPerSession: string;
  readonly estCostPerParticipant: string;
}

export type CourseFormField = keyof CourseFormState;

export const EMPTY_COURSE_FORM: CourseFormState = {
  code: '',
  titleEn: '',
  titleAr: '',
  descriptionEn: '',
  descriptionAr: '',
  category: '',
  newCategoryEn: '',
  newCategoryAr: '',
  deliveryType: 'classroom',
  durationHours: '',
  durationDays: '',
  minParticipants: '1',
  maxParticipants: '',
  estCostPerSession: '',
  estCostPerParticipant: '',
};

const text = (value: number | null) => (value === null ? '' : String(value));

export function courseFormFrom(course: CourseRow): CourseFormState {
  return {
    code: course.code,
    titleEn: course.titleEn ?? '',
    titleAr: course.titleAr ?? '',
    descriptionEn: course.descriptionEn ?? '',
    descriptionAr: course.descriptionAr ?? '',
    category: course.categoryId ?? '',
    newCategoryEn: '',
    newCategoryAr: '',
    deliveryType: course.deliveryType,
    durationHours: text(course.durationHours),
    durationDays: text(course.durationDays),
    minParticipants: text(course.minParticipants),
    maxParticipants: text(course.maxParticipants),
    estCostPerSession: text(course.estCostPerSession),
    estCostPerParticipant: text(course.estCostPerParticipant),
  };
}

/**
 * A number as typed: digits in any script, the Arabic decimal separator «٫», thousands separators («,»,
 * «٬», spaces) ignored. Empty → null; anything else that is not a number → NaN.
 */
export function parseNumber(value: string): number | null {
  const cleaned = normalizeDigits(value)
    .replace(/[\s,\u066C]/g, '')
    .replace(/\u066B/g, '.');
  if (cleaned === '') return null;
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

const decimalsOk = (value: number, places: number) =>
  Math.abs(Math.round(value * 10 ** places) - value * 10 ** places) < 1e-6;

/**
 * The values the create / update actions take (validated again on the server). The title in the
 * organization's default language is there; the other one may be '' (stored as none).
 */
export interface CourseActionValues {
  readonly code: string;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly descriptionEn: string;
  readonly descriptionAr: string;
  readonly category:
    | { readonly kind: 'none' }
    | { readonly kind: 'existing'; readonly id: string }
    | { readonly kind: 'new'; readonly nameEn: string; readonly nameAr: string };
  readonly deliveryType: DeliveryType;
  readonly durationHours: number;
  readonly durationDays: number | null;
  readonly minParticipants: number;
  readonly maxParticipants: number;
  readonly estCostPerSession: number | null;
  readonly estCostPerParticipant: number | null;
}

export type CourseFormErrors = Partial<Record<CourseFormField, string>>;

/**
 * Checks the form like the server (same limits and rules) so mistakes show before sending: field → error
 * code (message key `courses.fieldErrors.<code>`), or the values for the action when there are none. The
 * title — and a new category's name — is required in `nameLanguage` (the organization's default language)
 * and optional in the other one (PO, 12 Nov 2026). `stored`: the course being changed — titles left as
 * they are stored pass whatever they are (the server's rule: a course titled before the organization
 * changed its default language can still be changed otherwise).
 */
export function parseCourseForm(
  state: CourseFormState,
  nameLanguage: 'ar' | 'en',
  stored: Pick<CourseRow, 'titleEn' | 'titleAr'> | null = null,
):
  | { readonly values: CourseActionValues; readonly errors: null }
  | { readonly values: null; readonly errors: CourseFormErrors } {
  const errors: CourseFormErrors = {};
  /** A bilingual text: required in the default language, optional in the other; both within `max`. */
  const named = (fields: { en: CourseFormField; ar: CourseFormField }, max: number) => {
    const value = { en: state[fields.en].trim(), ar: state[fields.ar].trim() };
    for (const language of ['en', 'ar'] as const) {
      if (value[language] === '' && language === nameLanguage)
        errors[fields[language]] = 'REQUIRED';
      else if (value[language].length > max) errors[fields[language]] = 'TOO_LONG';
    }
    return value;
  };
  const code = normalizeDigits(state.code).trim();
  if (code === '') errors.code = 'REQUIRED';
  else if (!COURSE_CODE_RE.test(code)) errors.code = 'CODE_FORMAT';
  const title = named({ en: 'titleEn', ar: 'titleAr' }, COURSE_LIMITS.titleLength);
  const titleEn = title.en;
  const titleAr = title.ar;
  if (stored && (stored.titleEn ?? '') === titleEn && (stored.titleAr ?? '') === titleAr) {
    if (errors.titleEn === 'REQUIRED') delete errors.titleEn;
    if (errors.titleAr === 'REQUIRED') delete errors.titleAr;
  }
  for (const field of ['descriptionEn', 'descriptionAr'] as const) {
    if (state[field].trim().length > COURSE_LIMITS.descriptionLength) errors[field] = 'TOO_LONG';
  }
  let category: CourseActionValues['category'] = { kind: 'none' };
  if (state.category === 'new') {
    const name = named(
      { en: 'newCategoryEn', ar: 'newCategoryAr' },
      COURSE_LIMITS.categoryNameLength,
    );
    category = { kind: 'new', nameEn: name.en, nameAr: name.ar };
  } else if (state.category !== '') {
    category = { kind: 'existing', id: state.category };
  }
  const deliveryType = (DELIVERY_TYPES as readonly string[]).includes(state.deliveryType)
    ? (state.deliveryType as DeliveryType)
    : null;
  if (!deliveryType) errors.deliveryType = 'REQUIRED';

  const number = (
    field: CourseFormField,
    rule: { required: boolean; min: number; max: number; places: number; positive?: boolean },
  ): number | null => {
    const value = parseNumber(state[field]);
    if (value === null) {
      if (rule.required) errors[field] = 'REQUIRED';
      return null;
    }
    if (Number.isNaN(value)) errors[field] = 'NUMBER';
    else if ((rule.positive && value <= 0) || value < rule.min || value > rule.max) {
      errors[field] = 'OUT_OF_RANGE';
    } else if (!decimalsOk(value, rule.places))
      errors[field] = rule.places === 0 ? 'WHOLE' : 'DECIMALS';
    return value;
  };
  const durationHours = number('durationHours', {
    required: true,
    min: 0,
    max: COURSE_LIMITS.maxHours,
    places: 2,
    positive: true,
  });
  const durationDays = number('durationDays', {
    required: false,
    min: 0,
    max: COURSE_LIMITS.maxDays,
    places: 1,
    positive: true,
  });
  const limits = { required: true, min: 1, max: COURSE_LIMITS.maxParticipants, places: 0 };
  const minParticipants = number('minParticipants', limits);
  const maxParticipants = number('maxParticipants', limits);
  const money = { required: false, min: 0, max: COURSE_LIMITS.maxCost, places: 2 };
  const estCostPerSession = number('estCostPerSession', money);
  const estCostPerParticipant = number('estCostPerParticipant', money);

  if (
    Object.keys(errors).length === 0 &&
    durationHours !== null &&
    minParticipants !== null &&
    maxParticipants !== null &&
    deliveryType
  ) {
    for (const problem of courseFieldProblems({
      durationHours,
      durationDays,
      minParticipants,
      maxParticipants,
    })) {
      errors[problem.path as CourseFormField] = problem.code;
    }
  }
  if (
    Object.keys(errors).length > 0 ||
    !deliveryType ||
    durationHours === null ||
    minParticipants === null ||
    maxParticipants === null
  ) {
    return { values: null, errors };
  }
  return {
    values: {
      code,
      titleEn,
      titleAr,
      descriptionEn: state.descriptionEn,
      descriptionAr: state.descriptionAr,
      category,
      deliveryType,
      durationHours,
      durationDays,
      minParticipants,
      maxParticipants,
      estCostPerSession,
      estCostPerParticipant,
    },
    errors: null,
  };
}

// ---------------------------------------------------------------------------------------------------
// «Add course»: the popup (WP-UX-01 c; forms standard rule 9)
// ---------------------------------------------------------------------------------------------------

/** What the popup asks: the titles, the delivery type and the hours. */
export type CourseQuickField = 'titleEn' | 'titleAr' | 'deliveryType' | 'durationHours';
export type CourseQuickState = Pick<CourseFormState, CourseQuickField>;

export const EMPTY_COURSE_QUICK: CourseQuickState = {
  titleEn: '',
  titleAr: '',
  deliveryType: 'classroom',
  durationHours: '',
};

/** A new course's values: no code (the library gives the next free one). */
export type CourseCreateValues = Omit<CourseActionValues, 'code'>;

/**
 * Checks the popup like the settings form and fills in the rest (COURSE_DEFAULTS): no description, no
 * category, one to twenty participants, no costs — all changed later on the course's settings.
 */
export function parseCourseQuickForm(
  state: CourseQuickState,
  nameLanguage: 'ar' | 'en',
):
  | { readonly values: CourseCreateValues; readonly errors: null }
  | { readonly values: null; readonly errors: Partial<Record<CourseQuickField, string>> } {
  const parsed = parseCourseForm(
    {
      ...EMPTY_COURSE_FORM,
      ...state,
      // Not asked in the popup: a placeholder that passes the check and is never sent.
      code: 'NEW',
      minParticipants: String(COURSE_DEFAULTS.minParticipants),
      maxParticipants: String(COURSE_DEFAULTS.maxParticipants),
    },
    nameLanguage,
  );
  if (parsed.errors) {
    const { titleEn, titleAr, deliveryType, durationHours } = parsed.errors;
    return {
      values: null,
      errors: {
        ...(titleEn ? { titleEn } : {}),
        ...(titleAr ? { titleAr } : {}),
        ...(deliveryType ? { deliveryType } : {}),
        ...(durationHours ? { durationHours } : {}),
      },
    };
  }
  const { code: _code, ...values } = parsed.values;
  return { values, errors: null };
}

/** The tab of the settings page a field sits on (a refused save opens the first one with a mistake). */
export function courseFieldTab(field: CourseFormField): CourseSettingsTab {
  if (field === 'deliveryType' || field === 'durationHours' || field === 'durationDays') {
    return 'delivery';
  }
  if (
    field === 'minParticipants' ||
    field === 'maxParticipants' ||
    field === 'estCostPerSession' ||
    field === 'estCostPerParticipant'
  ) {
    return 'capacity';
  }
  return 'about';
}

/** The form field a server field error belongs to (paths of CourseValuesInput). */
export function courseFormFieldOf(path: string): CourseFormField | null {
  if (path === 'category.nameEn') return 'newCategoryEn';
  if (path === 'category.nameAr') return 'newCategoryAr';
  if (path.startsWith('category')) return 'category';
  const field = path.split('.')[0] ?? '';
  return field in EMPTY_COURSE_FORM ? (field as CourseFormField) : null;
}

/** Message key suffix (`courses.fieldErrors.*`) for a server field-error code. */
export function courseFieldErrorKey(code: string): string {
  const known = [
    'REQUIRED',
    'TOO_LONG',
    'CODE_FORMAT',
    'NUMBER',
    'OUT_OF_RANGE',
    'DECIMALS',
    'WHOLE',
    'MIN_ABOVE_MAX',
    'HOURS_ABOVE_DAYS',
    'CODE_TAKEN',
    'NAME_TAKEN',
    'NOT_FOUND',
  ];
  return known.includes(code) ? code : 'INVALID';
}
