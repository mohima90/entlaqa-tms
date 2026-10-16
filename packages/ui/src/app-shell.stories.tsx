import type { Meta, StoryObj } from '@storybook/react-vite';
import { type Copy, pick } from '../.storybook/l10n';
import { AppShell, PoweredBy } from './app-shell';
import { CommandPalette } from './command-palette';
import { Icon, type IconName } from './icons';
import { NavGroup, NavItem, NavUnavailable } from './nav-item';
import { PageHeader } from './page-header';
import { FullScreenToggle, NotificationBell, ThemeMenu, UserMenu } from './shell-controls';
import { StatCard, StatGrid } from './stat-card';

/**
 * The suite shell in the Kawadir layout (T-M2-43; docs/design/kawadir-alignment.md §3): a white
 * navigation (organization on top, grouped entries, «Powered by Jadarat») that collapses from 260 to
 * 72 px on a desktop, and a sticky top bar with the page title, the ⌘K / Ctrl K search, full screen,
 * theme, language, notifications and the account menu. Narrow the window below 900 px for the menu
 * button and the drawer (Escape closes it). Tagged `brand-matrix`: the story gate also runs it with
 * organization colours, whose gradient replaces the Jadarat one on the current entry (FR-ADM-07).
 */
const meta = {
  title: 'Layout/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  tags: ['brand-matrix'],
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;

type Globals = Record<string, unknown>;

interface DemoEntry {
  readonly key: string;
  readonly icon: IconName;
  readonly label: Copy;
  readonly soon?: boolean;
  readonly current?: boolean;
}

/** The Organization Admin's menu (kawadir-alignment.md §5). */
const GROUPS: readonly { key: string; heading?: Copy; entries: readonly DemoEntry[] }[] = [
  {
    key: 'main',
    entries: [{ key: 'home', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' } }],
  },
  {
    key: 'organization',
    heading: { ar: 'المنشأة', en: 'Organization' },
    entries: [
      {
        key: 'team',
        icon: 'people',
        label: { ar: 'أعضاء الفريق', en: 'Team members' },
        current: true,
      },
      {
        key: 'branding',
        icon: 'palette',
        label: { ar: 'الهوية البصرية', en: 'Branding' },
        soon: true,
      },
      { key: 'roles', icon: 'key', label: { ar: 'الأدوار والصلاحيات', en: 'Roles & permissions' } },
    ],
  },
  {
    key: 'billing',
    heading: { ar: 'الفوترة', en: 'Billing' },
    entries: [
      { key: 'plan', icon: 'billing', label: { ar: 'الاشتراك', en: 'Subscription' }, soon: true },
    ],
  },
  {
    key: 'settings',
    heading: { ar: 'الإعدادات', en: 'Settings' },
    entries: [
      { key: 'general', icon: 'settings', label: { ar: 'الإعدادات العامة', en: 'General' } },
      {
        key: 'email',
        icon: 'mail',
        label: { ar: 'تكامل البريد الإلكتروني', en: 'Email integration' },
        soon: true,
      },
      { key: 'security', icon: 'shield', label: { ar: 'الأمان', en: 'Security' } },
    ],
  },
];

const SOON: Copy = { ar: 'قريبًا', en: 'Coming soon' };

function demoNavigation(globals: Globals) {
  return GROUPS.map((group) => (
    <NavGroup
      key={group.key}
      id={group.heading ? `story-nav-${group.key}` : undefined}
      heading={group.heading ? pick(globals, group.heading) : undefined}
    >
      {group.entries.map((entry) => {
        const label = pick(globals, entry.label);
        return (
          <li key={entry.key}>
            {entry.soon ? (
              <NavUnavailable
                icon={<Icon name={entry.icon} />}
                label={label}
                note={pick(globals, SOON)}
                tooltip={`${label} · ${pick(globals, SOON)}`}
              />
            ) : (
              <NavItem
                href={`#${entry.key}`}
                current={entry.current}
                icon={<Icon name={entry.icon} />}
                tooltip={label}
              >
                {label}
              </NavItem>
            )}
          </li>
        );
      })}
    </NavGroup>
  ));
}

function DemoShell({ globals, collapsed }: { globals: Globals; collapsed: boolean }) {
  return (
    <AppShell
      brand={pick(globals, { ar: 'جدارات · التدريب', en: 'Jadarat TMS' })}
      organization={pick(globals, { ar: 'شركة الراية', en: 'Al Raya Company' })}
      title={pick(globals, { ar: 'أعضاء الفريق', en: 'Team members' })}
      initialCollapsed={collapsed}
      collapseLabels={{
        collapse: pick(globals, { ar: 'طيّ القائمة', en: 'Collapse menu' }),
        expand: pick(globals, { ar: 'توسيع القائمة', en: 'Expand menu' }),
      }}
      headerStart={
        <CommandPalette
          items={GROUPS.flatMap((group) =>
            group.entries
              .filter((entry) => !entry.soon)
              .map((entry) => ({
                id: entry.key,
                label: pick(globals, entry.label),
                group: pick(globals, group.heading ?? { ar: 'الصفحات', en: 'Pages' }),
                href: `#${entry.key}`,
                icon: entry.icon,
              })),
          )}
          texts={{
            trigger: pick(globals, { ar: 'ابحث في الصفحات…', en: 'Search pages…' }),
            title: pick(globals, { ar: 'البحث في الصفحات', en: 'Search pages' }),
            placeholder: pick(globals, { ar: 'اكتب اسم صفحة', en: 'Type a page name' }),
            empty: pick(globals, { ar: 'لا توجد نتائج.', en: 'No results.' }),
            close: pick(globals, { ar: 'إغلاق', en: 'Close' }),
          }}
          onNavigate={() => undefined}
        />
      }
      headerEnd={
        <>
          <FullScreenToggle
            texts={{
              enter: pick(globals, { ar: 'ملء الشاشة', en: 'Full screen' }),
              exit: pick(globals, { ar: 'الخروج من ملء الشاشة', en: 'Exit full screen' }),
            }}
          />
          <ThemeMenu
            initial="system"
            texts={{
              label: pick(globals, { ar: 'المظهر', en: 'Theme' }),
              light: pick(globals, { ar: 'فاتح', en: 'Light' }),
              dark: pick(globals, { ar: 'داكن', en: 'Dark' }),
              system: pick(globals, { ar: 'حسب النظام', en: 'System' }),
            }}
          />
          <a
            href="#language"
            className="inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-text-muted no-underline hover:bg-surface-hover hover:text-text pointer-coarse:min-h-11"
          >
            <Icon name="globe" className="size-5" />
            {pick(globals, { ar: 'English', en: 'العربية' })}
          </a>
          <NotificationBell
            texts={{
              label: pick(globals, { ar: 'الإشعارات', en: 'Notifications' }),
              emptyTitle: pick(globals, { ar: 'لا توجد إشعارات', en: 'No notifications' }),
              emptyBody: pick(globals, {
                ar: 'ستظهر الإشعارات هنا.',
                en: 'Notifications will appear here.',
              }),
            }}
          />
          <span aria-hidden="true" className="mx-2 hidden h-6 w-px bg-border md:block" />
          <UserMenu
            name={pick(globals, { ar: 'منيرة القحطاني', en: 'Mona Alzahrani' })}
            subtitle={pick(globals, {
              ar: 'شركة الراية · مدير المنشأة',
              en: 'Al Raya Company · Organization Admin',
            })}
            profileHref="#profile"
            texts={{
              profile: pick(globals, { ar: 'ملفي الشخصي', en: 'My profile' }),
              signOut: pick(globals, { ar: 'تسجيل الخروج', en: 'Sign out' }),
            }}
            onSignOut={() => Promise.resolve()}
          />
        </>
      }
      navigation={demoNavigation(globals)}
      navigationFooter={
        <PoweredBy
          title={pick(globals, { ar: 'مدعوم من جدارات', en: 'Powered by Jadarat' })}
          subtitle={pick(globals, { ar: 'نظام إدارة التدريب', en: 'Training Management System' })}
        />
      }
      navigationLabel={pick(globals, { ar: 'التنقل الرئيسي', en: 'Main navigation' })}
      skipToContentLabel={pick(globals, { ar: 'تخطَّ إلى المحتوى', en: 'Skip to content' })}
      menuLabel={pick(globals, { ar: 'القائمة', en: 'Menu' })}
      closeMenuLabel={pick(globals, { ar: 'إغلاق القائمة', en: 'Close menu' })}
    >
      <PageHeader
        title={pick(globals, { ar: 'أعضاء الفريق', en: 'Team members' })}
        description={pick(globals, {
          ar: 'أعضاء منشأتكم وأدوارهم والدعوات المعلّقة.',
          en: 'The people of your organization, their roles and pending invitations.',
        })}
      />
      <StatGrid label={pick(globals, { ar: 'ملخص', en: 'Summary' })}>
        <StatCard
          label={pick(globals, { ar: 'إجمالي الأعضاء', en: 'Total members' })}
          value="128"
          icon="people"
        />
        <StatCard label={pick(globals, { ar: 'نشط', en: 'Active' })} value="119" tone="success" />
        <StatCard
          label={pick(globals, { ar: 'الدعوات المعلّقة', en: 'Pending invites' })}
          value="6"
          tone="warning"
        />
        <StatCard
          label={pick(globals, { ar: 'معطَّل', en: 'Deactivated' })}
          value="3"
          tone="neutral"
        />
      </StatGrid>
    </AppShell>
  );
}

const shellArgs = {
  brand: '',
  navigation: null,
  navigationLabel: '',
  skipToContentLabel: '',
  menuLabel: '',
  closeMenuLabel: '',
  children: null,
} as const;

export const Default: Story = {
  args: shellArgs,
  render: (_args, { globals }) => <DemoShell globals={globals} collapsed={false} />,
};

/** Collapsed to icons (desktop): tooltips on hover and focus; the expand button at the bottom. */
export const Collapsed: Story = {
  args: shellArgs,
  render: (_args, { globals }) => <DemoShell globals={globals} collapsed />,
};
