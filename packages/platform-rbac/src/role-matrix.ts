import type { LocalizedText } from './permissions';
import { SYSTEM_ROLE_CODES, type SystemRoleCode } from './system-roles';

/**
 * The default roles and permission matrix shown on the roles page (BRD Appendix B; approved screen 5,
 * T-M2-05). It describes what each system role may do across the product, module by module, for
 * people to read. Enforcement lives in the permissions each role grants (system-roles.ts); a test keeps
 * the platform rows (users & roles, audit log) consistent with those grants. Later modules enforce
 * their own rows as they are built.
 */
export type AccessLevel = 'F' | 'E' | 'A' | 'V' | 'O' | 'U' | 'N' | 'AE' | 'EA' | 'FA';

export interface MatrixCell {
  readonly level: AccessLevel;
  /** Scope or limit of the access ("own sessions", "dept", …), when the matrix gives one. */
  readonly qualifier: LocalizedText | null;
}

export interface MatrixArea {
  readonly key: string;
  readonly name: LocalizedText;
  /** Sensitive area (settings, people, money, integrations, audit) — flagged on the page. */
  readonly sensitive: boolean;
  readonly access: Readonly<Record<SystemRoleCode, MatrixCell>>;
}

const QUALIFIERS = {
  dept: { ar: 'القسم', en: 'department' },
  team: { ar: 'الفريق', en: 'team' },
  assigned: { ar: 'المسندة فقط', en: 'assigned only' },
  ownCatalog: { ar: 'دليل الجهة فقط', en: 'own catalog only' },
  enrolled: { ar: 'المسجَّل فيها', en: 'enrolled' },
  cost: { ar: 'اعتماد التكلفة', en: 'cost approval' },
  roster: { ar: 'قائمة المتدربين', en: 'roster' },
  l3: { ar: 'تقييم المستوى الثالث', en: 'level 3 evaluation' },
  grading: { ar: 'التصحيح', en: 'grading' },
  upload: { ar: 'الرفع', en: 'upload' },
  payables: { ar: 'مستحقاته', en: 'own payables' },
  invoices: { ar: 'الفواتير', en: 'invoices' },
  finance: { ar: 'المالية', en: 'finance' },
  compliance: { ar: 'الامتثال', en: 'compliance' },
  ownSessions: { ar: 'جلساته', en: 'own sessions' },
  providerOwn: { ar: 'الخاصة بالجهة', en: "the provider's own" },
  mentees: { ar: 'المتدربون المسندون', en: 'assigned mentees' },
  hris: { ar: 'ربط نظام الموارد البشرية', en: 'HR system connection' },
  config: { ar: 'الإعداد', en: 'configuration' },
  logs: { ar: 'السجلات', en: 'logs' },
} as const satisfies Record<string, LocalizedText>;

type QualifierKey = keyof typeof QUALIFIERS;

/**
 * One area: cells in SYSTEM_ROLE_CODES order (Organization Admin … Auditor), `LEVEL` or
 * `LEVEL:qualifier`. Rows are copied from BRD Appendix B (Arabic wording of the approved screen 5). The
 * Organization Admin is a setup role (BRD v2.4, PO 7 Oct 2026): no access to the training areas.
 */
const ROWS: readonly [string, LocalizedText, boolean, string][] = [
  [
    'settings',
    {
      ar: 'إعدادات المنشأة والهوية البصرية والنطاقات',
      en: 'Organization settings, branding, domains',
    },
    true,
    'F N N N N N N N N N N N N V',
  ],
  [
    'users',
    { ar: 'المستخدمون والأدوار', en: 'Users & roles' },
    true,
    'F V V E V V V:dept V:team N N N N O V',
  ],
  [
    'requests',
    { ar: 'طلبات التدريب وحصر الاحتياجات', en: 'Training requests & needs analysis' },
    false,
    'N F E E V V AE AE N N N N O V',
  ],
  ['plan', { ar: 'الخطة التدريبية', en: 'Training plan' }, false, 'N F V A A V A V N N N N N V'],
  [
    'catalog',
    { ar: 'دليل الدورات والبرامج', en: 'Catalog & programs' },
    false,
    'N F E V V V V V V V:assigned E:ownCatalog V V V',
  ],
  [
    'sessions',
    { ar: 'الجلسات والجدولة', en: 'Sessions & scheduling' },
    false,
    'N F F V V V V V V:assigned V:assigned V:assigned N V:enrolled V',
  ],
  [
    'venues',
    { ar: 'المقرات والموارد', en: 'Venues & resources' },
    false,
    'N F E N V N N N N N N N N V',
  ],
  [
    'instructors',
    { ar: 'المدربون وجهات التدريب', en: 'Instructors & providers' },
    false,
    'N F E V V N N N O O O N N V',
  ],
  [
    'enrollments',
    { ar: 'التسجيلات والموافقات', en: 'Enrollments & approvals' },
    false,
    'N F E E A:cost V A A V:roster V:roster V:roster N O V',
  ],
  [
    'logistics',
    { ar: 'مهام التجهيز', en: 'Logistics tasks' },
    false,
    'N F F N V N N N E:assigned E:assigned E:assigned N N V',
  ],
  ['attendance', { ar: 'الحضور', en: 'Attendance' }, false, 'N F F V N V V V E E E N O V'],
  [
    'assessments',
    { ar: 'الاختبارات والاستبيانات', en: 'Assessments & evaluations' },
    false,
    'N F E V N V V V:l3 E:grading E:grading E:grading E O V',
  ],
  [
    'certificates',
    { ar: 'الشهادات والشهادات الخارجية', en: 'Certificates & external certificates' },
    false,
    'N F E EA N V V V N N E:upload N O V',
  ],
  [
    'compliance',
    { ar: 'قواعد الامتثال وتقاريره', en: 'Compliance rules & reports' },
    false,
    'N E V F N F V V N N N N O V',
  ],
  [
    'ojt',
    { ar: 'التدريب على رأس العمل والملاحظة', en: 'On-the-job training & observation' },
    false,
    'N F E V N V V V N N N E O V',
  ],
  [
    'finance',
    {
      ar: 'الميزانيات وأوامر الشراء والفواتير والمدفوعات',
      en: 'Budgets, purchase orders, invoices, payments',
    },
    true,
    'N E V V FA N V:dept N O:payables O:payables E:invoices N N V',
  ],
  [
    'reports',
    { ar: 'التقارير والتحليلات', en: 'Reports & analytics' },
    false,
    'N F E F F:finance F:compliance V:dept V:team V:ownSessions V:ownSessions V:providerOwn V:mentees O V',
  ],
  [
    'integrations',
    { ar: 'التكاملات وواجهة البرمجة', en: 'Integrations & API' },
    true,
    'F N N E:hris N N N N N N N N N V',
  ],
  [
    'ai',
    { ar: 'ميزات الذكاء الاصطناعي', en: 'AI features' },
    false,
    'F:config U U U U U U U U N N U U V:logs',
  ],
  ['audit', { ar: 'سجل التدقيق', en: 'Audit log' }, true, 'V N N N N V N N N N N N N V'],
];

const LEVELS: ReadonlySet<string> = new Set(['F', 'E', 'A', 'V', 'O', 'U', 'N', 'AE', 'EA', 'FA']);

function parseCell(raw: string): MatrixCell {
  const [level = '', qualifier] = raw.split(':');
  if (!LEVELS.has(level)) throw new Error(`role matrix: unknown level "${level}"`);
  if (qualifier !== undefined && !(qualifier in QUALIFIERS)) {
    throw new Error(`role matrix: unknown qualifier "${qualifier}"`);
  }
  return {
    level: level as AccessLevel,
    qualifier: qualifier === undefined ? null : QUALIFIERS[qualifier as QualifierKey],
  };
}

export const ROLE_MATRIX: readonly MatrixArea[] = ROWS.map(([key, name, sensitive, row]) => {
  const cells = row.split(' ');
  if (cells.length !== SYSTEM_ROLE_CODES.length) {
    throw new Error(`role matrix: area "${key}" has ${String(cells.length)} cells`);
  }
  return {
    key,
    name,
    sensitive,
    access: Object.fromEntries(
      SYSTEM_ROLE_CODES.map((code, index) => [code, parseCell(cells[index] ?? '')]),
    ) as Record<SystemRoleCode, MatrixCell>,
  };
});
