import type {
  FieldOption,
  FieldType,
  Localized,
  NeedsFormDefinition,
  NeedsFormField,
  PeopleMode,
  SystemKey,
} from './model';

/**
 * The default needs form every organization starts with (T-M3-10; business flow EP-PLN §12 (1)) — the same
 * texts as the database seed (private.seed_needs_form, migration 20261020180300; drift test). Used where
 * there is no database: the builder's preview mode.
 */
export const DEFAULT_FORM_NAME: Localized = {
  en: 'Default needs form',
  ar: 'نموذج الاحتياجات الافتراضي',
};

export const NEEDS_SECTION = {
  name: { en: 'Training needs', ar: 'الاحتياجات التدريبية' },
  description: {
    en: 'Add one entry for each training need of your team.',
    ar: 'أضف بندًا لكل احتياج تدريبي لفريقك.',
  },
  minEntries: 1,
  maxEntries: 50,
} as const;

const opt = (value: string, en: string, ar: string): FieldOption => ({ value, label: { en, ar } });

interface TemplateField {
  readonly systemKey: SystemKey | null;
  readonly type: FieldType;
  readonly label: Localized;
  readonly placeholder: Partial<Localized>;
  readonly required: boolean;
  readonly options: readonly FieldOption[];
  readonly peopleMode: PeopleMode | null;
}

const field = (
  type: FieldType,
  en: string,
  ar: string,
  more: Partial<TemplateField> = {},
): TemplateField => ({
  systemKey: null,
  type,
  label: { en, ar },
  placeholder: {},
  required: false,
  options: [],
  peopleMode: null,
  ...more,
});

export const TOPIC_FIELD = field('text', 'Training topic', 'موضوع التدريب', {
  systemKey: 'training_topic',
  required: true,
  placeholder: { en: 'For example: Project management basics', ar: 'مثال: أساسيات إدارة المشاريع' },
});

export const PEOPLE_FIELD = field('people', 'People', 'المشاركون', {
  systemKey: 'people',
  required: true,
  peopleMode: 'count_or_employees',
});

/** The default form's fields, in order. */
export const DEFAULT_FIELDS: readonly TemplateField[] = [
  TOPIC_FIELD,
  field('textarea', 'Description', 'الوصف', {
    placeholder: { en: 'What should the training cover?', ar: 'ما الذي ينبغي أن يغطيه التدريب؟' },
  }),
  field('select', 'Category', 'التصنيف', {
    options: [
      opt('technical', 'Technical', 'تقني'),
      opt('leadership', 'Leadership and management', 'القيادة والإدارة'),
      opt('soft_skills', 'Personal skills', 'المهارات الشخصية'),
      opt('digital', 'Digital skills', 'المهارات الرقمية'),
      opt('compliance', 'Compliance and regulations', 'الامتثال واللوائح'),
      opt('health_safety', 'Health and safety', 'الصحة والسلامة'),
    ],
  }),
  field('select', 'Preferred delivery type', 'نمط التقديم المفضّل', {
    options: [
      opt('classroom', 'Classroom', 'حضوري'),
      opt('virtual', 'Virtual', 'افتراضي'),
      opt('blended', 'Blended', 'مدمج'),
      opt('on_the_job', 'On the job', 'على رأس العمل'),
    ],
  }),
  PEOPLE_FIELD,
  field('select', 'Priority', 'الأولوية', {
    options: [
      opt('critical', 'Critical', 'حرجة'),
      opt('high', 'High', 'عالية'),
      opt('medium', 'Medium', 'متوسطة'),
      opt('low', 'Low', 'منخفضة'),
    ],
  }),
  field('select', 'Reason type', 'نوع السبب', {
    options: [
      opt('role_requirement', 'Role requirement', 'متطلب وظيفي'),
      opt('compliance', 'Compliance or mandatory', 'امتثال أو تدريب إلزامي'),
      opt('performance', 'Performance improvement', 'تحسين الأداء'),
      opt('development', 'Career development', 'تطوير مهني'),
      opt('new_project', 'New project', 'مشروع جديد'),
    ],
  }),
  field('textarea', 'Reason', 'السبب', {
    placeholder: {
      en: 'Why does your team need this training?',
      ar: 'لماذا يحتاج فريقك إلى هذا التدريب؟',
    },
  }),
  field('select', 'Preferred quarter', 'الربع المفضّل', {
    options: [
      opt('q1', 'First quarter', 'الربع الأول'),
      opt('q2', 'Second quarter', 'الربع الثاني'),
      opt('q3', 'Third quarter', 'الربع الثالث'),
      opt('q4', 'Fourth quarter', 'الربع الرابع'),
    ],
  }),
  // No «Estimated cost» field since WP-LD-01 (PO decision Q1, 27 Oct 2026): a need's cost is a column of the
  // need itself, entered on the Add-a-need panel under «More» (migration 20261105100200).
];

/**
 * A form built from the template with ids from `newId`: the default form (`full`) or a blank one (the two
 * system fields only), like the database's private.seed_needs_form.
 */
export function templateForm(options: {
  readonly newId: () => string;
  readonly name: Localized;
  readonly isDefault: boolean;
  readonly full: boolean;
}): NeedsFormDefinition {
  const fields: NeedsFormField[] = (
    options.full ? DEFAULT_FIELDS : [TOPIC_FIELD, PEOPLE_FIELD]
  ).map((f) => ({ ...f, id: options.newId(), visible: true, condition: null }));
  return {
    id: options.newId(),
    name: options.name,
    isDefault: options.isDefault,
    isActive: true,
    lockedAt: null,
    version: 1,
    sectionCount: 1,
    fieldCount: fields.length,
    sections: [
      {
        id: options.newId(),
        name: NEEDS_SECTION.name,
        description: NEEDS_SECTION.description,
        repeatable: true,
        minEntries: NEEDS_SECTION.minEntries,
        maxEntries: NEEDS_SECTION.maxEntries,
        visible: true,
        fields,
      },
    ],
  };
}
