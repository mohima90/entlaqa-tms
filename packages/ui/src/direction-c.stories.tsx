import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { DEMO_SHORTCUTS } from '../.storybook/demo-shell';
import { pick } from '../.storybook/l10n';
import { Alert } from './alert';
import { Badge } from './badge';
import { Button, buttonClasses } from './button';
import { Card } from './card';
import { Dialog } from './dialog';
import { EmptyState } from './empty-state';
import { Icon } from './icons';
import { PageHeader } from './page-header';
import { SaveBar, type SaveBarState } from './save-bar';
import { ShortcutsDialog } from './shortcuts-dialog';
import { FormSection, SidePanel } from './side-panel';
import { TableSkeleton } from './list-patterns';
import { TabNav } from './tab-nav';
import { TextField } from './text-field';
import { ViewCards } from './view-cards';

/**
 * The shared building blocks of direction C «Bold product» (redesign package 1, approved by the PO on
 * 21 Oct 2026; docs/design/redesign-direction-c.md): view cards with big numbers, the page header with
 * breadcrumbs and underline tabs, list states (loading, first use, no results), forms with the floating
 * save bar, the side panel and the confirmation dialogs, banners and badges, and the keyboard shortcuts
 * list. Every story runs in Arabic/English × light/dark under axe; tagged `brand-matrix`, also with
 * organization colours (FR-ADM-07).
 */
const meta = {
  title: 'Building blocks/Direction C',
  parameters: { layout: 'fullscreen' },
  tags: ['brand-matrix'],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
type Globals = Record<string, unknown>;

const VIEWS = [
  { key: 'all', label: { ar: 'الكل', en: 'All' }, count: '42' },
  { key: 'active', label: { ar: 'نشط', en: 'Active' }, count: '35' },
  { key: 'invited', label: { ar: 'الدعوات المعلّقة', en: 'Pending invites' }, count: '5' },
  { key: 'deactivated', label: { ar: 'معطّل', en: 'Deactivated' }, count: '2' },
] as const;

/** Saved-view cards: the status views of a list with big numbers; the current one on the gradient. */
export const ViewCardsWithBigNumbers: Story = {
  render: (_args, { globals }) => (
    <div className="flex flex-col gap-8 bg-bg p-6">
      <ViewCards
        label={pick(globals, { ar: 'عرض أعضاء الفريق', en: 'Team members views' })}
        current="all"
        items={VIEWS.map((view) => ({
          key: view.key,
          href: `#${view.key}`,
          label: pick(globals, view.label),
          count: view.count,
        }))}
      />
      <ViewCards
        label={pick(globals, { ar: 'عرض الدعوات', en: 'Invitations views' })}
        current="invited"
        items={VIEWS.map((view) => ({
          key: view.key,
          href: `#${view.key}`,
          label: pick(globals, view.label),
          count: view.count,
        }))}
      />
    </div>
  ),
};

/** The page header: breadcrumbs, a 38 px title, description, actions; underline tabs for one object. */
export const PageHeaderAndTabs: Story = {
  render: (_args, { globals }) => (
    <div className="bg-bg p-6">
      <PageHeader
        breadcrumbsLabel={pick(globals, { ar: 'مسار التنقل', en: 'Breadcrumb' })}
        breadcrumbs={[
          { label: pick(globals, { ar: 'أعضاء الفريق', en: 'Team members' }), href: '#team' },
          { label: pick(globals, { ar: 'سارة الحربي', en: 'Sara Al-Harbi' }) },
        ]}
        title={pick(globals, { ar: 'سارة الحربي', en: 'Sara Al-Harbi' })}
        description={pick(globals, {
          ar: 'مديرة التعلّم والتطوير · تطوير المواهب',
          en: 'L&D Manager · Talent Development',
        })}
        actions={
          <>
            <a href="#deactivate" className={buttonClasses({ variant: 'danger-outline' })}>
              {pick(globals, { ar: 'تعطيل', en: 'Deactivate' })}
            </a>
            <a href="#edit" className={buttonClasses({ variant: 'primary' })}>
              <Icon name="pencil" />
              {pick(globals, { ar: 'تعديل', en: 'Edit' })}
            </a>
          </>
        }
      />
      <TabNav
        variant="underline"
        label={pick(globals, { ar: 'أقسام الملف', en: 'Profile sections' })}
        current="details"
        items={[
          {
            key: 'details',
            href: '#details',
            label: pick(globals, { ar: 'البيانات', en: 'Details' }),
          },
          { key: 'roles', href: '#roles', label: pick(globals, { ar: 'الأدوار', en: 'Roles' }) },
          {
            key: 'activity',
            href: '#activity',
            label: pick(globals, { ar: 'النشاط', en: 'Activity' }),
          },
        ]}
      />
    </div>
  ),
};

/** List states: loading rows (with a status for screen readers), first use with steps, no results. */
export const ListStates: Story = {
  render: (_args, { globals }) => (
    <div className="flex flex-col gap-6 bg-bg p-6">
      <Card flush title={pick(globals, { ar: 'جارٍ التحميل', en: 'Loading' })}>
        <TableSkeleton rows={3} label={pick(globals, { ar: 'جارٍ التحميل…', en: 'Loading…' })} />
      </Card>
      <Card>
        <EmptyState
          icon="structure"
          title={pick(globals, { ar: 'لم تُبنَ الهيكلة بعد', en: 'No structure yet' })}
          description={pick(globals, {
            ar: 'ابدأ بتسمية المستويات، ثم أضف الوحدة الأولى.',
            en: 'Start by naming the levels, then add the first unit.',
          })}
          steps={[
            {
              title: pick(globals, { ar: 'سمِّ المستويات', en: 'Name the levels' }),
              description: pick(globals, {
                ar: 'مثل: الإدارة، القسم، الوحدة.',
                en: 'For example: Department, Section, Unit.',
              }),
            },
            {
              title: pick(globals, { ar: 'أضف الوحدة الأولى', en: 'Add the first unit' }),
              description: pick(globals, {
                ar: 'ثم أضف ما تحتها.',
                en: 'Then add the ones under it.',
              }),
            },
          ]}
        />
      </Card>
      <Card>
        <EmptyState
          icon="search"
          title={pick(globals, {
            ar: 'لا توجد نتائج تطابق عوامل التصفية',
            en: 'No results match the filters',
          })}
          description={pick(globals, {
            ar: 'غيّر البحث أو امسح عوامل التصفية.',
            en: 'Change the search or clear the filters.',
          })}
          action={
            <a href="#clear" className={buttonClasses({ variant: 'secondary' })}>
              {pick(globals, { ar: 'مسح عوامل التصفية', en: 'Clear filters' })}
            </a>
          }
        />
      </Card>
    </div>
  ),
};

function SettingsForm({ globals, state }: { globals: Globals; state: SaveBarState }) {
  return (
    <div className="flex flex-col gap-4 bg-bg p-6">
      <form
        id="story-settings"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <FormSection
          title={pick(globals, { ar: 'المنشأة', en: 'Organization' })}
          description={pick(globals, {
            ar: 'يظهر في القائمة الجانبية وفي الرسائل والشهادات.',
            en: 'Shown in the sidebar, on e-mails and on certificates.',
          })}
        >
          <TextField
            id="story-industry"
            label={pick(globals, { ar: 'القطاع', en: 'Industry' })}
            marker={pick(globals, { ar: '(مطلوب)', en: '(required)' })}
            error={pick(globals, { ar: 'اختر القطاع.', en: 'Choose an industry.' })}
          />
          <TextField
            id="story-country"
            label={pick(globals, { ar: 'الدولة', en: 'Country' })}
            marker={pick(globals, { ar: '(مطلوب)', en: '(required)' })}
            defaultValue={pick(globals, { ar: 'السعودية', en: 'Saudi Arabia' })}
            hint={pick(globals, {
              ar: 'يقترح اختيار الدولة العملة والمنطقة الزمنية.',
              en: 'Choosing a country suggests its currency and time zone.',
            })}
          />
        </FormSection>
      </form>
      <SaveBar
        state={state}
        form="story-settings"
        texts={{
          unsaved: pick(globals, { ar: 'لديك تغييرات لم تُحفظ.', en: 'You have unsaved changes.' }),
          saving: pick(globals, { ar: 'جارٍ الحفظ…', en: 'Saving…' }),
          saved: pick(globals, {
            ar: 'آخر تعديل بواسطة منيرة القحطاني',
            en: 'Last changed by Munira Alqahtani',
          }),
          save: pick(globals, { ar: 'حفظ التغييرات', en: 'Save changes' }),
          cancel: pick(globals, { ar: 'إلغاء', en: 'Cancel' }),
        }}
      />
    </div>
  );
}

/** A settings form: two-column sections, the error on the field, the floating save bar (unsaved). */
export const FormWithUnsavedChanges: Story = {
  render: (_args, { globals }) => <SettingsForm globals={globals} state="unsaved" />,
};

/** The same form at rest: the save bar says who changed it last. */
export const FormSaved: Story = {
  render: (_args, { globals }) => <SettingsForm globals={globals} state="saved" />,
};

function PanelDemo({ globals }: { globals: Globals }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="min-h-[560px] bg-bg p-6">
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {pick(globals, { ar: 'تعديل الوحدة', en: 'Edit unit' })}
      </Button>
      <SidePanel
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={pick(globals, { ar: 'تعديل الوحدة', en: 'Edit unit' })}
        description={pick(globals, { ar: 'تطوير المواهب', en: 'Talent Development' })}
        closeLabel={pick(globals, { ar: 'إغلاق', en: 'Close' })}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              {pick(globals, { ar: 'إلغاء', en: 'Cancel' })}
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              {pick(globals, { ar: 'حفظ', en: 'Save' })}
            </Button>
          </>
        }
      >
        <TextField
          id="story-unit-name"
          label={pick(globals, { ar: 'الاسم', en: 'Name' })}
          defaultValue={pick(globals, { ar: 'تطوير المواهب', en: 'Talent Development' })}
        />
      </SidePanel>
    </div>
  );
}

/** A side panel: edit one item without leaving the list (slides in at the inline end). */
export const SidePanelOpen: Story = {
  render: (_args, { globals }) => <PanelDemo globals={globals} />,
};

function ConfirmDemo({ globals, tone }: { globals: Globals; tone: 'danger' | 'warning' }) {
  const [open, setOpen] = useState(true);
  const danger = tone === 'danger';
  return (
    <div className="min-h-[420px] bg-bg p-6">
      <Button
        variant={danger ? 'danger-outline' : 'secondary'}
        onClick={() => {
          setOpen(true);
        }}
      >
        {danger
          ? pick(globals, { ar: 'إلغاء الدعوة', en: 'Revoke invitation' })
          : pick(globals, { ar: 'تعطيل الوحدة', en: 'Deactivate unit' })}
      </Button>
      <Dialog
        open={open}
        tone={tone}
        onClose={() => {
          setOpen(false);
        }}
        title={
          danger
            ? pick(globals, { ar: 'إلغاء الدعوة؟', en: 'Revoke this invitation?' })
            : pick(globals, { ar: 'تعطيل هذه الوحدة؟', en: 'Deactivate this unit?' })
        }
        description={
          danger
            ? pick(globals, {
                ar: 'لن يعمل الرابط ولا الرمز بعد ذلك. لا يمكن التراجع عن ذلك.',
                en: 'The link and the code stop working. This cannot be undone.',
              })
            : pick(globals, {
                ar: 'تختفي من القوائم، ويمكنك إعادة تفعيلها لاحقًا.',
                en: 'It leaves the pick lists; you can reactivate it later.',
              })
        }
        closeLabel={pick(globals, { ar: 'إغلاق', en: 'Close' })}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              {pick(globals, { ar: 'إلغاء', en: 'Cancel' })}
            </Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              onClick={() => {
                setOpen(false);
              }}
            >
              {danger
                ? pick(globals, { ar: 'إلغاء الدعوة', en: 'Revoke invitation' })
                : pick(globals, { ar: 'تعطيل', en: 'Deactivate' })}
            </Button>
          </>
        }
      />
    </div>
  );
}

/** A destructive confirmation (cannot be undone): the red tile and a red main button. */
export const DialogDestructive: Story = {
  render: (_args, { globals }) => <ConfirmDemo globals={globals} tone="danger" />,
};

/** A reversible consequence: the amber tile. */
export const DialogReversible: Story = {
  render: (_args, { globals }) => <ConfirmDemo globals={globals} tone="warning" />,
};

/** Banners (info, success, warning with an action, danger) and badges (status pills, brand, neutral). */
export const BannersAndBadges: Story = {
  render: (_args, { globals }) => (
    <div className="flex flex-col gap-4 bg-bg p-6">
      <Alert tone="info">
        {pick(globals, {
          ar: 'يُضبط اسم المنشأة بالعربية والإنجليزية في صفحة الهوية البصرية.',
          en: "The organization's names in English and Arabic are set on the Branding page.",
        })}
      </Alert>
      <Alert tone="success">
        {pick(globals, { ar: 'حُفظت الإعدادات.', en: 'Settings saved.' })}
      </Alert>
      <Alert
        tone="warning"
        title={pick(globals, { ar: 'انتهت صلاحية دعوتين', en: 'Two invitations expired' })}
        action={
          <a href="#resend" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            {pick(globals, { ar: 'إعادة الإرسال', en: 'Resend' })}
          </a>
        }
      >
        {pick(globals, {
          ar: 'لم يُقبل الرابط خلال 7 أيام.',
          en: 'The link was not accepted within 7 days.',
        })}
      </Alert>
      <Alert tone="danger">
        {pick(globals, {
          ar: 'تعذّر الحفظ. المرجع: 7F3A-91C2',
          en: 'Could not save. Reference: 7F3A-91C2',
        })}
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Badge tone="success" dot>
          {pick(globals, { ar: 'نشط', en: 'Active' })}
        </Badge>
        <Badge tone="warning" dot>
          {pick(globals, { ar: 'مدعو', en: 'Invited' })}
        </Badge>
        <Badge dot>{pick(globals, { ar: 'معطّل', en: 'Deactivated' })}</Badge>
        <Badge tone="brand">{pick(globals, { ar: 'المستوى 2', en: 'Level 2' })}</Badge>
        <Badge tone="danger">{pick(globals, { ar: 'دور ذو امتياز', en: 'Privileged role' })}</Badge>
        <Badge>{pick(globals, { ar: 'قريبًا', en: 'Coming soon' })}</Badge>
      </div>
    </div>
  ),
};

function ShortcutsDemo({ globals }: { globals: Globals }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="min-h-[420px] bg-bg p-6">
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="keyboard" />
        {pick(globals, { ar: 'اختصارات لوحة المفاتيح', en: 'Keyboard shortcuts' })}
      </Button>
      <ShortcutsDialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={pick(globals, { ar: 'اختصارات لوحة المفاتيح', en: 'Keyboard shortcuts' })}
        closeLabel={pick(globals, { ar: 'إغلاق', en: 'Close' })}
        items={DEMO_SHORTCUTS.map((item) => ({
          label: pick(globals, item.label),
          keys: item.keys,
        }))}
      />
    </div>
  );
}

/** The keyboard shortcuts list (design only: the shortcuts the product already has). */
export const KeyboardShortcuts: Story = {
  render: (_args, { globals }) => <ShortcutsDemo globals={globals} />,
};

/** Buttons: pills — primary gradient, secondary, ghost, danger, busy (spinner) and large. */
export const Buttons: Story = {
  render: (_args, { globals }) => (
    <div className="flex flex-wrap items-center gap-3 bg-bg p-6">
      <Button>{pick(globals, { ar: 'دعوة مستخدم', en: 'Invite user' })}</Button>
      <Button variant="secondary">{pick(globals, { ar: 'استيراد', en: 'Import' })}</Button>
      <Button variant="ghost">{pick(globals, { ar: 'إلغاء', en: 'Cancel' })}</Button>
      <Button variant="danger">{pick(globals, { ar: 'حذف', en: 'Delete' })}</Button>
      <Button busy disabled>
        {pick(globals, { ar: 'جارٍ الحفظ…', en: 'Saving…' })}
      </Button>
      <Button size="lg">{pick(globals, { ar: 'متابعة', en: 'Continue' })}</Button>
    </div>
  ),
};
