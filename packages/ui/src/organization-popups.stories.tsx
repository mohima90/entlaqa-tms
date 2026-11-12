import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';
import { pick } from '../.storybook/l10n';
import { Alert } from './alert';
import { Button } from './button';
import { Dialog } from './dialog';
import { Icon } from './icons';
import { TextField } from './text-field';

/**
 * The organization set-up popups (WP-UX-01 b; forms standard rules 8–9, PO 12 Nov 2026): adding a
 * department or a branch and inviting a member are one centred popup — 448 px for a simple thing, 672 px
 * for a rich one — with the few fields needed now, a red asterisk on the required ones, the name in the
 * organization's default language required and the other language optional, everything optional behind
 * «More options», and «Cancel» then the primary button at the end. The markup follows apps/suite
 * (components/structure/unit-panel.tsx, branch-panel.tsx, components/users/invite-user-form.tsx); sample
 * names only. Every story runs in Arabic/English × light/dark under axe.
 */
const meta = {
  title: 'Pages/Organization set-up popups',
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
  more: { ar: 'خيارات أكثر', en: 'More options' },
  nameEn: { ar: 'الاسم بالإنجليزية', en: 'Name in English' },
  nameAr: { ar: 'الاسم بالعربية', en: 'Name in Arabic' },
  code: { ar: 'الرمز', en: 'Code' },
  audited: {
    ar: 'يُسجَّل كل تغيير في سجل التدقيق.',
    en: 'Every change is recorded in the audit log.',
  },
} as const;

/** «More options»: a disclosure button and the region it shows (hidden, never unmounted, in the app). */
function More({
  globals,
  id,
  summary,
  startOpen,
  children,
}: {
  globals: Globals;
  id: string;
  summary: string;
  startOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button
        type="button"
        className="flex min-h-10 flex-wrap items-center gap-1.5 self-start rounded-full px-2 text-start text-sm font-semibold text-primary-text hover:bg-primary-subtle pointer-coarse:min-h-11"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-end'} />
        {pick(globals, T.more)}
        <span className="font-normal text-text-muted">
          {' · '}
          {summary}
        </span>
      </button>
      <div id={id} className={open ? 'flex flex-col gap-4' : 'hidden'}>
        {children}
      </div>
    </>
  );
}

/** The two names: the page's language stands in for the organization's default language here. */
function Names({ globals, prefix }: { globals: Globals; prefix: string }) {
  const first = globals.locale === 'en' ? 'en' : 'ar';
  const order = first === 'en' ? (['en', 'ar'] as const) : (['ar', 'en'] as const);
  return (
    <>
      {order.map((language) => (
        <TextField
          key={language}
          id={`${prefix}-name-${language}`}
          label={pick(globals, language === 'en' ? T.nameEn : T.nameAr)}
          marker={pick(globals, language === first ? T.required : T.optional)}
          required={language === first}
          dir={language === 'ar' ? 'rtl' : 'ltr'}
          lang={language}
        />
      ))}
    </>
  );
}

const footer = (globals: Globals, primary: { ar: string; en: string }) => (
  <>
    <Button variant="secondary">{pick(globals, T.cancel)}</Button>
    <Button>{pick(globals, primary)}</Button>
  </>
);

const audit = (globals: Globals) => (
  <p className="m-0 flex items-start gap-2 text-[13px] text-text-muted">
    <Icon name="shield-outline" className="mt-0.5 shrink-0" />
    {pick(globals, T.audited)}
  </p>
);

/** Add a department: a simple thing, 448 px — the names, then «More options» (code, branch, head). */
export const AddDepartment: Story = {
  render: (_args, { globals }) => (
    <div className="min-h-dvh bg-bg p-6">
      <Dialog
        open
        onClose={() => undefined}
        size="sm"
        title={pick(globals, { ar: 'إضافة إدارة', en: 'Add Department' })}
        description={pick(globals, {
          ar: 'إدارة في المستوى الأعلى من الهيكل.',
          en: 'A department at the top level of the structure.',
        })}
        closeLabel={pick(globals, T.close)}
        footer={footer(globals, { ar: 'إضافة', en: 'Add' })}
      >
        <Names globals={globals} prefix="story-unit" />
        <More
          globals={globals}
          id="story-unit-more"
          summary={pick(globals, { ar: 'الرمز SAL', en: 'Code SAL' })}
          startOpen={false}
        >
          <TextField
            id="story-unit-code"
            label={pick(globals, T.code)}
            marker={pick(globals, T.required)}
            required
            dir="ltr"
            defaultValue="SAL"
          />
        </More>
        {audit(globals)}
      </Dialog>
    </div>
  ),
};

/** Once added, the same popup offers the next step (forms standard rule 3). */
export const DepartmentAdded: Story = {
  render: (_args, { globals }) => (
    <div className="min-h-dvh bg-bg p-6">
      <Dialog
        open
        onClose={() => undefined}
        size="sm"
        title={pick(globals, { ar: 'أُضيفت المبيعات', en: 'Sales added' })}
        description={pick(globals, { ar: 'ما التالي؟', en: 'What next?' })}
        closeLabel={pick(globals, T.close)}
        footer={
          <>
            <Button variant="secondary">{pick(globals, { ar: 'تم', en: 'Done' })}</Button>
            <Button variant="secondary">
              <Icon name="plus" />
              {pick(globals, { ar: 'إضافة إدارة أخرى', en: 'Add another Department' })}
            </Button>
            <Button>
              <Icon name="plus" />
              {pick(globals, { ar: 'إضافة قسم تحتها', en: 'Add a Section under it' })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
          <span className="grid size-14 place-items-center rounded-full bg-success-subtle text-success">
            <Icon name="check" className="size-7" />
          </span>
          <p className="m-0 max-w-[36ch] text-sm text-text-muted">
            {pick(globals, {
              ar: 'يمكنك إضافة ما تحت المبيعات من مستوى «قسم» الآن، أو لاحقًا من صفها.',
              en: 'You can add the Sections under Sales now, or later from its row.',
            })}
          </p>
        </div>
      </Dialog>
    </div>
  ),
};

/**
 * Add a branch: a rich thing, 672 px — the two names side by side from 600 px (one per row on phones), the
 * code and the time zone; the address and the rest behind «More options», open here.
 */
export const AddBranchWithMore: Story = {
  render: (_args, { globals }) => (
    <div className="min-h-dvh bg-bg p-6">
      <Dialog
        open
        onClose={() => undefined}
        size="rich"
        title={pick(globals, { ar: 'إضافة فرع', en: 'Add a branch' })}
        description={pick(globals, {
          ar: 'اسم الفرع ورمزه ومنطقته الزمنية. الباقي اختياري.',
          en: 'The names, code and time zone of the branch. Everything else is optional.',
        })}
        closeLabel={pick(globals, T.close)}
        footer={footer(globals, { ar: 'إضافة الفرع', en: 'Add branch' })}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Names globals={globals} prefix="story-branch" />
        </div>
        <TextField
          id="story-branch-code"
          label={pick(globals, T.code)}
          marker={pick(globals, T.required)}
          required
          dir="ltr"
        />
        <More
          globals={globals}
          id="story-branch-more"
          summary={pick(globals, {
            ar: 'الفرع الأعلى والموقع وأسبوع العمل والمقر الرئيسي',
            en: 'Parent branch, location, working week and headquarters',
          })}
          startOpen
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField
              id="story-branch-latitude"
              label={pick(globals, { ar: 'خط العرض', en: 'Latitude' })}
              marker={pick(globals, T.optional)}
              dir="ltr"
            />
            <TextField
              id="story-branch-longitude"
              label={pick(globals, { ar: 'خط الطول', en: 'Longitude' })}
              marker={pick(globals, T.optional)}
              dir="ltr"
            />
          </div>
        </More>
        {audit(globals)}
      </Dialog>
    </div>
  ),
};

/** Invite a member: 672 px — e-mail, the default language's names, then «More options». */
export const InviteMember: Story = {
  render: (_args, { globals }) => (
    <div className="min-h-dvh bg-bg p-6">
      <Dialog
        open
        onClose={() => undefined}
        size="rich"
        title={pick(globals, { ar: 'دعوة مستخدم', en: 'Invite a user' })}
        description={pick(globals, {
          ar: 'ننشئ رمز دعوة ورابطًا يمكنك نسخهما ومشاركتهما مع الشخص.',
          en: 'We create an invitation code and a link that you can copy and share with the person.',
        })}
        closeLabel={pick(globals, T.close)}
        footer={footer(globals, { ar: 'إرسال الدعوة', en: 'Send invitation' })}
      >
        <TextField
          id="story-invite-email"
          type="email"
          label={pick(globals, { ar: 'البريد الإلكتروني للعمل', en: 'Work email' })}
          marker={pick(globals, T.required)}
          required
          dir="ltr"
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField
            id="story-invite-first"
            label={pick(globals, { ar: 'الاسم الأول بالعربية', en: 'First name in English' })}
            marker={pick(globals, T.required)}
            required
          />
          <TextField
            id="story-invite-family"
            label={pick(globals, { ar: 'اسم العائلة بالعربية', en: 'Family name in English' })}
            marker={pick(globals, T.required)}
            required
          />
        </div>
        <More
          globals={globals}
          id="story-invite-more"
          summary={pick(globals, {
            ar: 'بيانات العمل والاسم بالإنجليزية',
            en: 'Work details and the name in Arabic',
          })}
          startOpen={false}
        >
          <TextField
            id="story-invite-number"
            label={pick(globals, { ar: 'الرقم الوظيفي', en: 'Employee number' })}
            marker={pick(globals, T.optional)}
            dir="ltr"
          />
        </More>
        <Alert tone="info">
          {pick(globals, {
            ar: 'تبقى الدعوة صالحة 7 أيام.',
            en: 'The invitation stays valid for 7 days.',
          })}
        </Alert>
      </Dialog>
    </div>
  ),
};
