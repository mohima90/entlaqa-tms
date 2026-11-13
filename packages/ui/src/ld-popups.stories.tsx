import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { pick } from '../.storybook/l10n';
import { Button } from './button';
import { Dialog } from './dialog';
import { Icon } from './icons';
import { TextField } from './text-field';

/**
 * The learning & development popups (WP-UX-01 c; forms standard rules 8–9, PO 12 Nov 2026): adding a need
 * on «My team's needs» and creating a role are one centred popup of 672 px with the few fields needed now,
 * a red asterisk on the required ones, the name in the organization's default language required and the
 * other language optional (side by side from 600 px), and «Cancel» then the primary button at the end, in the
 * dialog's footer, which stays in view. The markup follows apps/suite (components/needs/need-dialog.tsx,
 * components/roles/create-role.tsx); sample names only. «Add course» and «New needs form» are seen on their
 * pages without a database (the e2e journeys). Every story runs in Arabic/English × light/dark under axe.
 */
const meta = {
  title: 'Pages/Learning & development popups',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
type Globals = Record<string, unknown>;

const T = {
  close: { ar: 'إغلاق', en: 'Close' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  optional: { ar: '(اختياري)', en: '(optional)' },
  required: { ar: '(مطلوب)', en: '(required)' },
} as const;

const SELECT =
  'select-chevron min-h-12 w-full rounded-md border-[1.5px] border-border-strong bg-surface ps-3.5 pe-10 text-[15px] text-text';

/** A labelled native select, as apps/suite's SelectField draws it. */
function Select({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select
        id={id}
        className={SELECT}
        aria-describedby={hint ? `${id}-hint` : undefined}
        defaultValue=""
      >
        {children}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className="m-0 text-[13.5px] text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The two names: the page's language stands in for the organization's default language here. */
function Names({
  globals,
  prefix,
  labels,
  values,
}: {
  globals: Globals;
  prefix: string;
  labels: { readonly en: { ar: string; en: string }; readonly ar: { ar: string; en: string } };
  values?: { readonly en?: string; readonly ar?: string };
}) {
  const first = globals.locale === 'en' ? 'en' : 'ar';
  const order = first === 'en' ? (['en', 'ar'] as const) : (['ar', 'en'] as const);
  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
      {order.map((language) => (
        <TextField
          key={language}
          id={`${prefix}-name-${language}`}
          label={pick(globals, labels[language])}
          marker={pick(globals, language === first ? T.required : T.optional)}
          required={language === first}
          dir={language === 'ar' ? 'rtl' : 'ltr'}
          lang={language}
          defaultValue={values?.[language] ?? ''}
        />
      ))}
    </div>
  );
}

const TEAM = [
  { ar: 'سارة الحربي', en: 'Sara Alharbi', chosen: true },
  { ar: 'خالد العتيبي', en: 'Khalid Alotaibi', chosen: false },
  { ar: 'منيرة القحطاني', en: 'Munira Alqahtani', chosen: false },
] as const;

/**
 * «Add a need» on «My team's needs»: the course from the library or a topic of one's own, how many people,
 * who (optional names from the team), the organization's other fields under «More», the estimated cost.
 */
export const AddNeed: Story = {
  render: (_args, { globals }) => (
    <div className="min-h-dvh bg-bg p-6">
      <Dialog
        open
        onClose={() => undefined}
        size="rich"
        title={pick(globals, { ar: 'إضافة احتياج', en: 'Add a need' })}
        footer={
          <>
            <Button variant="secondary">{pick(globals, T.cancel)}</Button>
            <Button variant="secondary">
              {pick(globals, { ar: 'حفظ وإضافة آخر', en: 'Save and add another' })}
            </Button>
            <Button>{pick(globals, { ar: 'حفظ', en: 'Save' })}</Button>
          </>
        }
        description={pick(globals, {
          ar: 'الموضوع وعدد الأشخاص. الأسماء اختيارية: تُسمّى المقاعد غير المسماة عند جدولة التدريب.',
          en: 'A topic and how many people. Names are optional: unnamed seats are named when the training is scheduled.',
        })}
        closeLabel={pick(globals, T.close)}
      >
        <div className="flex flex-col gap-5">
          <Select
            id="story-need-course"
            label={pick(globals, { ar: 'دورة من الدليل', en: 'Course from the library' })}
            hint={pick(globals, {
              ar: 'اختيار دورة يملأ الموضوع، ويمكنك تغييره.',
              en: 'Picking a course fills in the topic; you can still change it.',
            })}
          >
            <option value="">
              {pick(globals, {
                ar: 'ليست من الدليل — موضوع من عندي',
                en: 'Not from the library — my own topic',
              })}
            </option>
            <option value="lead">
              {pick(globals, { ar: 'الإدارة الاستراتيجية', en: 'Strategic management' })}
            </option>
          </Select>
          <TextField
            id="story-need-topic"
            label={pick(globals, { ar: 'موضوع التدريب', en: 'Training topic' })}
            marker={pick(globals, T.required)}
            required
            defaultValue={pick(globals, {
              ar: 'خدمة العملاء عبر الهاتف',
              en: 'Customer service by phone',
            })}
          />
          <TextField
            id="story-need-count"
            type="number"
            label={pick(globals, { ar: 'عدد الأشخاص', en: 'How many people' })}
            marker={pick(globals, T.required)}
            required
            defaultValue="3"
          />
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="flex flex-wrap items-center gap-x-1 p-0 text-sm font-semibold">
              {pick(globals, { ar: 'من', en: 'Who' })}
              <span className="font-normal text-text-subtle">{pick(globals, T.optional)}</span>
            </legend>
            <ul className="m-0 flex list-none flex-col rounded-md border border-border p-0">
              {TEAM.map((member, index) => (
                <li key={member.en} className="border-b border-border last:border-b-0">
                  <label
                    htmlFor={`story-need-p-${String(index)}`}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm ${member.chosen ? 'bg-primary-subtle' : ''}`}
                  >
                    <input
                      id={`story-need-p-${String(index)}`}
                      type="checkbox"
                      className="size-4 accent-primary"
                      defaultChecked={member.chosen}
                    />
                    {pick(globals, member)}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border px-4 py-3 text-start text-sm font-semibold"
            aria-expanded={false}
          >
            <span>
              {pick(globals, { ar: 'المزيد', en: 'More' })}
              <span className="ms-2 font-normal text-text-muted">
                {pick(globals, {
                  ar: 'تفاصيل تطلبها منظمتك.',
                  en: 'Details your organization asks for.',
                })}
              </span>
            </span>
            <Icon name="chevron-down" className="size-4" />
          </button>
          <TextField
            id="story-need-cost"
            inputMode="decimal"
            dir="ltr"
            label={pick(globals, { ar: 'التكلفة التقديرية (SAR)', en: 'Estimated cost (SAR)' })}
            marker={pick(globals, T.optional)}
          />
        </div>
      </Dialog>
    </div>
  ),
};

/**
 * «Create role» on Roles & permissions: what the role starts from (a blank role, a copy of a standard role,
 * a template) and its names; creating opens the builder as the role's own page.
 */
export const CreateRole: Story = {
  render: (_args, { globals }) => (
    <div className="min-h-dvh bg-bg p-6">
      <Dialog
        open
        onClose={() => undefined}
        size="rich"
        title={pick(globals, { ar: 'إنشاء دور', en: 'Create role' })}
        footer={
          <>
            <Button variant="secondary">{pick(globals, T.cancel)}</Button>
            <Button>{pick(globals, { ar: 'إنشاء دور', en: 'Create role' })}</Button>
          </>
        }
        description={pick(globals, {
          ar: 'سمِّ الدور واختر ما يبدأ منه. تُفتح بعد ذلك صلاحياته والبيانات التي يراها.',
          en: 'Name the role and choose what it starts from. Its permissions and the data it sees open next.',
        })}
        closeLabel={pick(globals, T.close)}
      >
        <div className="flex flex-col gap-4">
          <Select
            id="story-role-start"
            label={pick(globals, { ar: 'البدء من', en: 'Start from' })}
            hint={pick(globals, {
              ar: 'يملأ الصلاحيات (والاسم والوصف للقوالب). يمكنك تعديلها في صفحة الدور.',
              en: "Fills in the permissions (and, for a template, the name and description). You can change them on the role's page.",
            })}
          >
            <option value="">{pick(globals, { ar: 'دور فارغ', en: 'A blank role' })}</option>
            <optgroup label={pick(globals, { ar: 'نسخ دور قياسي', en: 'Copy a standard role' })}>
              <option value="hr">
                {pick(globals, { ar: 'مدير الموارد البشرية', en: 'HR Manager' })}
              </option>
            </optgroup>
          </Select>
          <Names
            globals={globals}
            prefix="story-role"
            labels={{
              en: { ar: 'الاسم بالإنجليزية', en: 'Name in English' },
              ar: { ar: 'الاسم بالعربية', en: 'Name in Arabic' },
            }}
            values={{ en: 'Finance approver', ar: 'معتمد مالي' }}
          />
          <p className="m-0 rounded-xl bg-surface-sunken px-3.5 py-3 text-[13px] leading-relaxed text-text-muted">
            {pick(globals, {
              ar: 'عند إنشاء الدور تُفتح صفحته: اختر صلاحياته والبيانات التي يراها وأضف وصفًا له. لا يحمل أحد الدور حتى تسنده.',
              en: 'Creating the role opens its page: tick its permissions, choose the data it sees and add a description. Nobody holds the role until you give it.',
            })}
          </p>
        </div>
      </Dialog>
    </div>
  ),
};
