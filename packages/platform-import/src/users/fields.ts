/**
 * The fields a file column may be imported into (T-M2-12; approved screen 3 «أعمدة قالب الاستيراد», design
 * README §3) — the same allow-list as the database (private.user_import_mapping_is_valid, TM-0003
 * T-IAM-20): never account status, passwords, roles of existing users, memberships or restricted data.
 */
export const IMPORT_FIELDS = [
  'email',
  'first_name_ar',
  'father_name_ar',
  'grandfather_name_ar',
  'family_name_ar',
  'first_name_en',
  'father_name_en',
  'grandfather_name_en',
  'family_name_en',
  'mobile',
  'employee_number',
  'job_title_ar',
  'job_title_en',
  'department',
  'branch',
  // WP-HR-01 (business flow EP-ORG-structure-completion.md §3 A): the person's one cost centre.
  'cost_centre',
  'manager_email',
  'hire_date',
  'primary_role',
  'additional_roles',
  'language',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * The language whose first and family names a file must give: the organization's default language
 * (guided-test feedback #2, PO 17 Oct 2026; English unless the admin chose Arabic). The other language's
 * names are optional.
 */
export type NameLanguage = 'ar' | 'en';

const NAME_FIELDS_OF: Readonly<Record<NameLanguage, readonly ImportField[]>> = {
  ar: ['first_name_ar', 'father_name_ar', 'grandfather_name_ar', 'family_name_ar'],
  en: ['first_name_en', 'father_name_en', 'grandfather_name_en', 'family_name_en'],
};

/** The fields a file must have: the e-mail and the first and family names in `nameLanguage`. */
export function requiredFields(nameLanguage: NameLanguage): readonly ImportField[] {
  return nameLanguage === 'ar'
    ? ['email', 'first_name_ar', 'family_name_ar']
    : ['email', 'first_name_en', 'family_name_en'];
}

/**
 * The field definitions as a template, the guide and the mapping show them for an organization whose names
 * are required in `nameLanguage`: that language's name columns first (right after the e-mail) and marked
 * required, the other language's optional.
 */
export function fieldDefinitionsFor(nameLanguage: NameLanguage): readonly FieldDefinition[] {
  const required = new Set(requiredFields(nameLanguage));
  const other = nameLanguage === 'ar' ? 'en' : 'ar';
  const order = [
    'email',
    ...NAME_FIELDS_OF[nameLanguage],
    ...NAME_FIELDS_OF[other],
  ] as readonly ImportField[];
  const rank = (field: ImportField) => {
    const index = order.indexOf(field);
    return index === -1 ? order.length + IMPORT_FIELDS.indexOf(field) : index;
  };
  return [...FIELD_DEFINITIONS]
    .sort((a, b) => rank(a.field) - rank(b.field))
    .map((d) => ({ ...d, required: required.has(d.field) }));
}

export function isImportField(value: string): value is ImportField {
  return (IMPORT_FIELDS as readonly string[]).includes(value);
}

export type FieldGroup = 'identity' | 'work' | 'roles';

export interface FieldDefinition {
  readonly field: ImportField;
  /**
   * In FIELD_DEFINITIONS: always required (the e-mail). Which names are required depends on the
   * organization's default language: fieldDefinitionsFor() sets it.
   */
  readonly required: boolean;
  readonly group: FieldGroup;
  /** The template's header in each language (screen 3). */
  readonly header: { readonly ar: string; readonly en: string };
  /** Other headers recognized for it (HR systems' exports), in any letter case and Arabic spelling. */
  readonly synonyms: readonly string[];
  /** Screen 3's description and example. */
  readonly description: { readonly ar: string; readonly en: string };
  readonly example: string;
  /** Template column width (characters) and format. */
  readonly width: number;
  readonly format: 'text' | 'date';
}

export const FIELD_DEFINITIONS: readonly FieldDefinition[] = [
  {
    field: 'email',
    required: true,
    group: 'identity',
    header: { ar: 'البريد الإلكتروني للعمل', en: 'Work email' },
    synonyms: [
      'البريد الإلكتروني',
      'البريد',
      'بريد العمل',
      'الإيميل',
      'ايميل',
      'الإيميل الرسمي',
      'email',
      'e-mail',
      'email address',
      'work e-mail',
      'business email',
      'official email',
      'mail',
    ],
    description: {
      ar: 'يصبح اسم الدخول للشخص، ولا يتكرر في المنشأة. نتعرّف به على من هم مستخدمون من قبل.',
      en: "Becomes the person's sign-in name and must be unique in the organization. We use it to recognize people who are already users.",
    },
    example: 'n.aldossari@alraya.example',
    width: 32,
    format: 'text',
  },
  {
    field: 'first_name_ar',
    required: false,
    group: 'identity',
    header: { ar: 'الاسم الأول', en: 'First name (Arabic)' },
    synonyms: [
      'الاسم',
      'الاسم الأول بالعربية',
      'first name arabic',
      'arabic first name',
      'first name ar',
    ],
    description: { ar: 'بالعربية، حتى 60 حرفًا.', en: 'In Arabic, up to 60 characters.' },
    example: 'نورة',
    width: 16,
    format: 'text',
  },
  {
    field: 'father_name_ar',
    required: false,
    group: 'identity',
    header: { ar: 'اسم الأب', en: "Father's name (Arabic)" },
    synonyms: ['الأب', 'اسم الأب بالعربية', 'father name arabic', 'father name ar'],
    description: { ar: 'بالعربية.', en: 'In Arabic.' },
    example: 'فهد',
    width: 16,
    format: 'text',
  },
  {
    field: 'grandfather_name_ar',
    required: false,
    group: 'identity',
    header: { ar: 'اسم الجد', en: "Grandfather's name (Arabic)" },
    synonyms: ['الجد', 'اسم الجد بالعربية', 'grandfather name arabic', 'grandfather name ar'],
    description: { ar: 'بالعربية.', en: 'In Arabic.' },
    example: 'سعد',
    width: 16,
    format: 'text',
  },
  {
    field: 'family_name_ar',
    required: false,
    group: 'identity',
    header: { ar: 'اسم العائلة', en: 'Family name (Arabic)' },
    synonyms: [
      'العائلة',
      'اللقب',
      'الاسم الأخير',
      'اسم العائلة بالعربية',
      'family name arabic',
      'last name arabic',
      'family name ar',
    ],
    description: { ar: 'بالعربية، حتى 60 حرفًا.', en: 'In Arabic, up to 60 characters.' },
    example: 'الدوسري',
    width: 16,
    format: 'text',
  },
  {
    field: 'first_name_en',
    required: false,
    group: 'identity',
    header: { ar: 'الاسم الأول بالإنجليزية', en: 'First name (English)' },
    synonyms: [
      'first name',
      'given name',
      'first name english',
      'first name en',
      'english first name',
    ],
    description: {
      ar: 'بالحروف اللاتينية، حتى 60 حرفًا.',
      en: 'In Latin letters, up to 60 characters.',
    },
    example: 'Noura',
    width: 16,
    format: 'text',
  },
  {
    field: 'father_name_en',
    required: false,
    group: 'identity',
    header: { ar: 'اسم الأب بالإنجليزية', en: "Father's name (English)" },
    synonyms: ["father's name", 'father name', 'father name english', 'middle name'],
    description: { ar: 'بالحروف اللاتينية.', en: 'In Latin letters.' },
    example: 'Fahad',
    width: 16,
    format: 'text',
  },
  {
    field: 'grandfather_name_en',
    required: false,
    group: 'identity',
    header: { ar: 'اسم الجد بالإنجليزية', en: "Grandfather's name (English)" },
    synonyms: ["grandfather's name", 'grandfather name', 'grandfather name english'],
    description: { ar: 'بالحروف اللاتينية.', en: 'In Latin letters.' },
    example: 'Saad',
    width: 16,
    format: 'text',
  },
  {
    field: 'family_name_en',
    required: false,
    group: 'identity',
    header: { ar: 'اسم العائلة بالإنجليزية', en: 'Family name (English)' },
    synonyms: ['family name', 'last name', 'surname', 'family name english', 'last name english'],
    description: {
      ar: 'بالحروف اللاتينية، حتى 60 حرفًا.',
      en: 'In Latin letters, up to 60 characters.',
    },
    example: 'Aldossari',
    width: 16,
    format: 'text',
  },
  {
    field: 'mobile',
    required: false,
    group: 'work',
    header: { ar: 'رقم الجوال', en: 'Mobile' },
    synonyms: [
      'الجوال',
      'جوال',
      'الهاتف',
      'رقم الهاتف',
      'الهاتف الجوال',
      'الموبايل',
      'mobile number',
      'mobile phone',
      'phone',
      'phone number',
      'cell phone',
    ],
    description: {
      ar: 'مع رمز الدولة. تُقبل الأرقام العربية والمسافات والشرطات.',
      en: 'With the country code. Arabic digits, spaces and dashes are fine.',
    },
    example: '+966 55 123 4567',
    width: 18,
    format: 'text',
  },
  {
    field: 'employee_number',
    required: false,
    group: 'work',
    header: { ar: 'الرقم الوظيفي', en: 'Employee number' },
    synonyms: [
      'رقم الموظف',
      'الرقم الوظيفى',
      'رقم وظيفي',
      'employee id',
      'employee no',
      'emp id',
      'emp no',
      'staff id',
      'staff number',
    ],
    description: {
      ar: 'لا يتكرر في المنشأة. حروف وأرقام، حتى 40 حرفًا.',
      en: 'Unique in the organization. Letters and digits, up to 40 characters.',
    },
    example: 'EMP-1450',
    width: 16,
    format: 'text',
  },
  {
    field: 'job_title_ar',
    required: false,
    group: 'work',
    header: { ar: 'المسمى الوظيفي بالعربية', en: 'Job title (Arabic)' },
    synonyms: ['المسمى الوظيفي', 'المسمى', 'الوظيفة', 'job title arabic', 'job title ar'],
    description: { ar: 'حتى 150 حرفًا.', en: 'Up to 150 characters.' },
    example: 'أخصائية تدريب',
    width: 24,
    format: 'text',
  },
  {
    field: 'job_title_en',
    required: false,
    group: 'work',
    header: { ar: 'المسمى الوظيفي بالإنجليزية', en: 'Job title (English)' },
    synonyms: [
      'job title',
      'title',
      'position',
      'designation',
      'job title english',
      'job title en',
    ],
    description: { ar: 'حتى 150 حرفًا.', en: 'Up to 150 characters.' },
    example: 'Training Specialist',
    width: 24,
    format: 'text',
  },
  {
    field: 'department',
    required: false,
    group: 'work',
    // A unit of the structure at any level: the organization names its own levels (guided-test feedback #3,
    // PO 17 Oct 2026). Files made with the earlier template («القسم» / “Department”) are still recognized.
    header: { ar: 'الوحدة', en: 'Unit' },
    synonyms: [
      'القسم',
      'department',
      'الإدارة',
      'اسم القسم',
      'رمز القسم',
      'اسم الوحدة',
      'رمز الوحدة',
      'dept',
      'department name',
      'department code',
      'unit name',
      'unit code',
      'division',
    ],
    description: {
      ar: 'اسم وحدة من الهيكل التنظيمي (في أي مستوى) أو رمزها كما في المنظمة ← الهيكل. لا يُنشئ الاستيراد وحدات جديدة.',
      en: "Name or code of a unit of the structure (any level), as in Organization → Structure. The import doesn't create units.",
    },
    example: 'التدريب والتطوير',
    width: 22,
    format: 'text',
  },
  {
    field: 'branch',
    required: false,
    group: 'work',
    header: { ar: 'الفرع', en: 'Branch' },
    synonyms: ['اسم الفرع', 'رمز الفرع', 'branch name', 'branch code'],
    description: {
      ar: 'اسم الفرع أو رمزه كما في «بيانات المنشأة».',
      en: 'Branch name or code, as in Organization data.',
    },
    example: 'فرع الرياض',
    width: 18,
    format: 'text',
  },
  {
    field: 'cost_centre',
    required: false,
    group: 'work',
    header: { ar: 'مركز التكلفة', en: 'Cost centre' },
    synonyms: [
      'رمز مركز التكلفة',
      'اسم مركز التكلفة',
      'cost center',
      'cost centre code',
      'cost center code',
    ],
    description: {
      ar: 'رمز مركز التكلفة أو اسمه كما في المنظمة ← الهيكل ← مراكز التكلفة. إذا تُرك فارغًا يأخذ الشخص مركز التكلفة الافتراضي لوحدته.',
      en: "Cost centre code or name, as in Organization → Structure → Cost centres. Left empty, the person gets their unit's default cost centre.",
    },
    example: 'CC-100',
    width: 18,
    format: 'text',
  },
  {
    field: 'manager_email',
    required: false,
    group: 'work',
    header: { ar: 'بريد المدير المباشر', en: "Direct manager's email" },
    synonyms: [
      'بريد المدير',
      'البريد الإلكتروني للمدير المباشر',
      'manager email',
      "manager's email",
      'line manager email',
      'supervisor email',
      'direct manager email',
    ],
    description: {
      ar: 'البريد الإلكتروني للعمل لمستخدم نشط، أو لشخص في الملف نفسه.',
      en: 'Work email of an active user, or of a person in the same file.',
    },
    example: 'k.alshehri@alraya.example',
    width: 32,
    format: 'text',
  },
  {
    field: 'hire_date',
    required: false,
    group: 'work',
    header: { ar: 'تاريخ التعيين', en: 'Hire date' },
    synonyms: [
      'تاريخ الالتحاق',
      'تاريخ المباشرة',
      'تاريخ الانضمام',
      'date of joining',
      'joining date',
      'date of hire',
      'start date',
    ],
    description: { ar: 'بالتاريخ الميلادي: سنة-شهر-يوم.', en: 'Gregorian, written YYYY-MM-DD.' },
    example: '2024-03-03',
    width: 14,
    format: 'date',
  },
  {
    field: 'primary_role',
    required: false,
    group: 'roles',
    header: { ar: 'الدور الأساسي', en: 'Primary role' },
    synonyms: ['الدور', 'role', 'role name'],
    description: {
      ar: 'اسم الدور بالعربية أو الإنجليزية كما في ورقة «القوائم». إن تُرك فارغًا يُسند الدور الافتراضي الذي تختاره أثناء الاستيراد. لا تُسند الأدوار المميزة بالاستيراد.',
      en: "Role name in Arabic or English, as on the Lists sheet. If empty, the default role you choose during the import applies. Privileged roles can't be given by import.",
    },
    example: 'منسق التدريب',
    width: 20,
    format: 'text',
  },
  {
    field: 'additional_roles',
    required: false,
    group: 'roles',
    header: { ar: 'أدوار إضافية', en: 'Additional roles' },
    synonyms: ['الأدوار الإضافية', 'other roles'],
    // One role per person since EP-ROLES (PO, 17 Oct 2026): still read from older files, never given.
    description: {
      ar: 'لا تُسند: لكل شخص دور واحد. يبقى العمود لقراءة الملفات القديمة، وتُتجاهل قيمه.',
      en: 'Not given: each person has one role. The column stays for older files; its values are ignored.',
    },
    example: '',
    width: 20,
    format: 'text',
  },
  {
    field: 'language',
    required: false,
    group: 'roles',
    header: { ar: 'اللغة المفضلة', en: 'Preferred language' },
    synonyms: ['اللغة', 'لغة التواصل', 'language', 'preferred locale'],
    description: {
      ar: 'العربية أو English. تحدد لغة الواجهة واللغة الأولى في رسالة الدعوة. إن تُركت فارغة تُستخدم لغة المنشأة.',
      en: "العربية or English. Sets the interface language and the language shown first in the invitation. If empty, the organization's language applies.",
    },
    example: 'العربية',
    width: 14,
    format: 'text',
  },
];

export function fieldDefinition(field: ImportField): FieldDefinition {
  const found = FIELD_DEFINITIONS.find((d) => d.field === field);
  if (!found) throw new Error(`unknown import field ${field}`);
  return found;
}

/**
 * Why a column is never imported (screen 5 «لا يُستورد»): account status, passwords, restricted personal
 * data (FR-IAM-02, TM-0004 F-PEO-05), and the columns our error report adds. Their values are neither
 * read nor stored, not even as samples.
 */
export type NeverImportedReason = 'status' | 'password' | 'restricted' | 'report';

export const NEVER_IMPORTED: Readonly<Record<NeverImportedReason, readonly string[]>> = {
  status: [
    'الحالة',
    'حالة الحساب',
    'حالة المستخدم',
    'status',
    'account status',
    'user status',
    'active',
  ],
  password: ['كلمة المرور', 'كلمة السر', 'الرقم السري', 'password', 'passcode', 'pin'],
  restricted: [
    'الجنس',
    'النوع',
    'تاريخ الميلاد',
    'رقم الهوية',
    'الهوية',
    'الهوية الوطنية',
    'رقم الهوية الوطنية',
    'السجل المدني',
    'رقم الإقامة',
    'الإقامة',
    'رقم الجواز',
    'جواز السفر',
    'الجنسية',
    'الديانة',
    'الحالة الاجتماعية',
    'الراتب',
    'رقم الآيبان',
    'الآيبان',
    'gender',
    'sex',
    'date of birth',
    'birth date',
    'birthdate',
    'dob',
    'national id',
    'id number',
    'national id number',
    'iqama',
    'iqama number',
    'passport',
    'passport number',
    'nationality',
    'religion',
    'marital status',
    'salary',
    'iban',
  ],
  report: [
    'الصف في الملف',
    'النتيجة',
    'السبب',
    'رمز السبب',
    'row in file',
    'result',
    'reason',
    'reason code',
  ],
};
