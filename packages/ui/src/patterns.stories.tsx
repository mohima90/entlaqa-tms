import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { pick } from '../.storybook/l10n';
import { Badge } from './badge';
import { Button, buttonClasses } from './button';
import { Card } from './card';
import { Dialog } from './dialog';
import { EmptyState } from './empty-state';
import { Icon } from './icons';
import { PageHeader } from './page-header';
import { StatCard, StatGrid } from './stat-card';
import { TabNav } from './tab-nav';
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { createToastStore } from './toast-store';
import { Toaster } from './toaster';
import { Toolbar, toolbarFieldClasses } from './toolbar';
import { TextField } from './text-field';

/**
 * Page patterns of the Kawadir layout (T-M2-43; docs/design/kawadir-alignment.md §4): a list as a
 * Table inside a Card with a toolbar above, summary stat cards, views as tabs, short forms in dialogs,
 * sonner-style toasts and empty states. Every story runs in Arabic/English × light/dark under axe.
 */
const meta = {
  title: 'Patterns/Kawadir',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const MEMBERS = [
  {
    ar: 'منيرة القحطاني',
    en: 'Munira Alqahtani',
    email: 'munira@example.com',
    role: { ar: 'مدير المنشأة', en: 'Organization Admin' },
    active: true,
  },
  {
    ar: 'خالد العتيبي',
    en: 'Khalid Alotaibi',
    email: 'khalid@example.com',
    role: { ar: 'مدير الموارد البشرية', en: 'HR Manager' },
    active: true,
  },
  {
    ar: 'سارة الحربي',
    en: 'Sara Alharbi',
    email: 'sara@example.com',
    role: { ar: 'متعلّم', en: 'Learner' },
    active: false,
  },
] as const;

/** Team members (Kawadir team page): header, stat cards, tabs, toolbar, table in a card. */
export const TeamMembersList: Story = {
  render: (_args, { globals }) => (
    <div className="flex flex-col gap-6 bg-bg p-6">
      <PageHeader
        title={pick(globals, { ar: 'أعضاء الفريق', en: 'Team members' })}
        description={pick(globals, {
          ar: 'أعضاء منشأتكم وأدوارهم والدعوات المعلّقة.',
          en: 'The people of your organization, their roles and pending invitations.',
        })}
        actions={
          <a href="#invite" className={buttonClasses({ variant: 'primary' })}>
            <Icon name="user-plus" />
            {pick(globals, { ar: 'دعوة مستخدم', en: 'Invite user' })}
          </a>
        }
      />
      <StatGrid label={pick(globals, { ar: 'ملخص', en: 'Summary' })}>
        <StatCard
          label={pick(globals, { ar: 'إجمالي الأعضاء', en: 'Total members' })}
          value="3"
          icon="people"
        />
        <StatCard
          label={pick(globals, { ar: 'نشط', en: 'Active' })}
          value="2"
          tone="success"
          icon="success"
        />
        <StatCard
          label={pick(globals, { ar: 'الدعوات المعلّقة', en: 'Pending invites' })}
          value="1"
          tone="warning"
          icon="mail"
        />
        <StatCard
          label={pick(globals, { ar: 'معطَّل', en: 'Deactivated' })}
          value="0"
          icon="user"
        />
      </StatGrid>
      <TabNav
        label={pick(globals, { ar: 'عرض أعضاء الفريق', en: 'Team members views' })}
        current="members"
        items={[
          {
            key: 'members',
            href: '#members',
            icon: 'people',
            label: pick(globals, { ar: 'الأعضاء', en: 'Members' }),
            count: '3',
          },
          {
            key: 'invites',
            href: '#invites',
            icon: 'mail',
            label: pick(globals, { ar: 'الدعوات المعلّقة', en: 'Pending invites' }),
            count: '1',
          },
        ]}
      />
      <Toolbar>
        <form className="flex w-full flex-col gap-1 md:max-w-md" role="search">
          <label htmlFor="story-q" className="text-sm font-medium">
            {pick(globals, { ar: 'بحث', en: 'Search' })}
          </label>
          <input id="story-q" type="search" className={toolbarFieldClasses} />
        </form>
      </Toolbar>
      <Card flush title={pick(globals, { ar: 'الأعضاء', en: 'Members' })} headingLevel={2}>
        <DataTable caption={pick(globals, { ar: 'أعضاء الفريق', en: 'Team members' })}>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(globals, { ar: 'العضو', en: 'Member' })}</TableHead>
              <TableHead>{pick(globals, { ar: 'الدور', en: 'Role' })}</TableHead>
              <TableHead>{pick(globals, { ar: 'الحالة', en: 'Status' })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MEMBERS.map((m) => (
              <TableRow key={m.email}>
                <TableCell>
                  <a href="#member" className="font-medium">
                    {pick(globals, m)}
                  </a>
                  <div className="text-text-muted">
                    <bdi dir="ltr">{m.email}</bdi>
                  </div>
                </TableCell>
                <TableCell>{pick(globals, m.role)}</TableCell>
                <TableCell>
                  <Badge tone={m.active ? 'success' : 'neutral'}>
                    {m.active
                      ? pick(globals, { ar: 'نشط', en: 'Active' })
                      : pick(globals, { ar: 'معطَّل', en: 'Deactivated' })}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      </Card>
    </div>
  ),
};

/**
 * Summary cards in their three Kawadir variants (Analytics layout): white target cards with a progress
 * bar, KPI cards on the brand gradient (Jadarat slate → steel; text checked on both ends; never a fixed
 * hue) with a trend line and a decorative sparkline, and the small plain cards. Tagged `brand-matrix`:
 * the story gate also runs it with organization colours, which recolour the KPI cards (FR-ADM-07).
 */
export const SummaryCards: Story = {
  tags: ['brand-matrix'],
  render: (_args, { globals }) => (
    <div className="flex flex-col gap-6 bg-bg p-6">
      <StatGrid label={pick(globals, { ar: 'الأهداف', en: 'Targets' })} columns={3}>
        <StatCard
          variant="target"
          label={pick(globals, { ar: 'الحضور هذا الشهر', en: 'Attendance this month' })}
          value="2"
          target="/ 10"
          progress={20}
          progressLabel={pick(globals, { ar: 'اكتمل 20٪', en: '20% complete' })}
        />
        <StatCard
          variant="target"
          label={pick(globals, { ar: 'الجلسات المكتملة', en: 'Sessions completed' })}
          value="0"
          target="/ 50"
          progress={0}
          progressLabel={pick(globals, { ar: 'اكتمل 0٪', en: '0% complete' })}
        />
        <StatCard
          variant="target"
          label={pick(globals, { ar: 'الشهادات الصادرة', en: 'Certificates issued' })}
          value="8"
          target="/ 100"
          progress={8}
          progressLabel={pick(globals, { ar: 'اكتمل 8٪', en: '8% complete' })}
        />
      </StatGrid>
      <StatGrid label={pick(globals, { ar: 'المؤشرات', en: 'Key figures' })}>
        <StatCard
          variant="gradient"
          label={pick(globals, { ar: 'إجمالي التسجيلات', en: 'Total enrolments' })}
          value="8"
          icon="sessions"
          trend={{
            direction: 'up',
            label: pick(globals, { ar: '0٪ مقارنة بالفترة السابقة', en: '0% vs previous' }),
          }}
          sparkline={[0, 0, 0, 2, 0, 0]}
        />
        <StatCard
          variant="gradient"
          label={pick(globals, { ar: 'مكتمل هذا الشهر', en: 'Completed this month' })}
          value="2"
          icon="success"
          trend={{
            direction: 'up',
            label: pick(globals, { ar: '0٪ مقارنة بالفترة السابقة', en: '0% vs previous' }),
          }}
          sparkline={[1, 1, 1, 1]}
        />
        <StatCard
          variant="gradient"
          label={pick(globals, { ar: 'متوسط مدة الإكمال', en: 'Avg. time to complete' })}
          value={pick(globals, { ar: '14 يومًا', en: '14 days' })}
          icon="calendar"
          trend={{
            direction: 'flat',
            label: pick(globals, { ar: '0٪ مقارنة بالفترة السابقة', en: '0% vs previous' }),
          }}
        />
        <StatCard
          variant="gradient"
          label={pick(globals, { ar: 'نسبة الحضور', en: 'Attendance rate' })}
          value="0%"
          icon="people"
          trend={{
            direction: 'down',
            label: pick(globals, { ar: '0٪ مقارنة بالفترة السابقة', en: '0% vs previous' }),
          }}
          sparkline={[0, 0, 1, 3]}
        />
      </StatGrid>
      <StatGrid label={pick(globals, { ar: 'ملخص', en: 'Summary' })}>
        <StatCard
          variant="gradient"
          label={pick(globals, { ar: 'بألوان المنشأة', en: 'In the brand colours' })}
          value="24"
          icon="building"
          hint={pick(globals, {
            ar: 'هوية المنشأة تستبدلها',
            en: "An organization's branding replaces it",
          })}
        />
        <StatCard
          label={pick(globals, { ar: 'الإجمالي', en: 'Total' })}
          value="8"
          trend={{
            direction: 'up',
            label: pick(globals, { ar: '+2 هذا الأسبوع', en: '+2 this week' }),
          }}
        />
        <StatCard label={pick(globals, { ar: 'جديد', en: 'New' })} value="0" tone="primary" />
        <StatCard
          label={pick(globals, { ar: 'تم التوظيف', en: 'Hired' })}
          value="0"
          tone="success"
          hint={pick(globals, { ar: 'هذا الشهر', en: 'This month' })}
        />
      </StatGrid>
    </div>
  ),
};

/** Nothing to show yet: icon, title, one line, the primary action (inside a card). */
export const Empty: Story = {
  render: (_args, { globals }) => (
    <div className="bg-bg p-6">
      <Card>
        <EmptyState
          icon="mail"
          title={pick(globals, { ar: 'لا توجد دعوات معلّقة', en: 'No pending invites' })}
          description={pick(globals, {
            ar: 'ستظهر هنا الدعوات التي لم تُقبل بعد.',
            en: 'Invitations that have not been accepted yet appear here.',
          })}
          action={
            <a href="#invite" className={buttonClasses({ variant: 'primary' })}>
              <Icon name="user-plus" />
              {pick(globals, { ar: 'دعوة مستخدم', en: 'Invite user' })}
            </a>
          }
        />
      </Card>
    </div>
  ),
};

function DialogDemo({
  globals,
  startOpen,
}: {
  globals: Record<string, unknown>;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="bg-bg p-6">
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        {pick(globals, { ar: 'دعوة مستخدم', en: 'Invite user' })}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={pick(globals, { ar: 'دعوة مستخدم', en: 'Invite user' })}
        description={pick(globals, {
          ar: 'نرسل إليه رابطًا لإنشاء حسابه.',
          en: 'We send them a link to create their account.',
        })}
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
              {pick(globals, { ar: 'إرسال الدعوة', en: 'Send invitation' })}
            </Button>
          </>
        }
      >
        <TextField
          id="story-invite-email"
          label={pick(globals, { ar: 'البريد الإلكتروني', en: 'Email' })}
          type="email"
          dir="ltr"
        />
      </Dialog>
    </div>
  );
}

/** A short form in a dialog (native <dialog>: page inert, Escape closes, focus returns). */
export const DialogOpen: Story = {
  render: (_args, { globals }) => <DialogDemo globals={globals} startOpen />,
};

/** The dialog's trigger; open it with Enter or a click, close it with Escape. */
export const DialogClosed: Story = {
  render: (_args, { globals }) => <DialogDemo globals={globals} startOpen={false} />,
};

const toasts = createToastStore();

function ToastsDemo({ globals }: { globals: Record<string, unknown> }) {
  if (toasts.items().length === 0) {
    toasts.add(
      'success',
      pick(globals, { ar: 'حُفظت الإعدادات العامة.', en: 'General settings saved.' }),
      {
        duration: null,
      },
    );
    toasts.add(
      'error',
      pick(globals, { ar: 'تعذّر إرسال الدعوة.', en: 'The invitation was not sent.' }),
      {
        description: pick(globals, { ar: 'حاول مرة أخرى.', en: 'Please try again.' }),
      },
    );
  }
  return (
    <div className="min-h-80 bg-bg p-6">
      <Button
        variant="secondary"
        onClick={() =>
          toasts.add('info', pick(globals, { ar: 'نُسخ الرابط.', en: 'Link copied.' }))
        }
      >
        {pick(globals, { ar: 'إظهار إشعار', en: 'Show a toast' })}
      </Button>
      <Toaster
        store={toasts}
        label={pick(globals, { ar: 'الإشعارات', en: 'Notifications' })}
        closeLabel={pick(globals, { ar: 'إغلاق', en: 'Close' })}
      />
    </div>
  );
}

/** sonner-style toasts at the bottom end: success and error (errors stay until closed). */
export const Toasts: Story = {
  render: (_args, { globals }) => <ToastsDemo globals={globals} />,
};
