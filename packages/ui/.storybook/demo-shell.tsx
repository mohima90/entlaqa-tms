import type { ReactNode } from 'react';
import { AppShell, PoweredBy } from '../src/app-shell';
import { CommandPalette } from '../src/command-palette';
import { Icon, type IconName } from '../src/icons';
import { NavGroup, NavItem, NavUnavailable } from '../src/nav-item';
import { NotificationBell, ThemeMenu, UserMenu } from '../src/shell-controls';
import { type Copy, pick } from './l10n';

/**
 * The suite shell with the Organization Admin's menu and sample data (kawadir-alignment.md §5), for the
 * shell and page stories: the same parts, order and texts as apps/suite/src/components/suite-shell.tsx and
 * suiteNavigation (apps/suite/src/lib/suite-navigation.ts). Theme previews use it too (PreviewShell).
 */
type Globals = Record<string, unknown>;

export type DemoPage = 'home' | 'team' | 'roles' | 'general' | 'security';

interface DemoEntry {
  readonly key: string;
  readonly icon: IconName;
  readonly label: Copy;
  readonly soon?: boolean;
}

const GROUPS: readonly { key: string; heading?: Copy; entries: readonly DemoEntry[] }[] = [
  {
    key: 'main',
    entries: [{ key: 'home', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' } }],
  },
  {
    key: 'organization',
    heading: { ar: 'المنشأة', en: 'Organization' },
    entries: [
      { key: 'team', icon: 'people', label: { ar: 'أعضاء الفريق', en: 'Team members' } },
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
      {
        key: 'integrations',
        icon: 'plug',
        label: { ar: 'التكاملات', en: 'Integrations' },
        soon: true,
      },
      { key: 'security', icon: 'shield', label: { ar: 'الأمان', en: 'Security' } },
      { key: 'audit', icon: 'audit', label: { ar: 'سجل التدقيق', en: 'Audit log' }, soon: true },
    ],
  },
];

const SOON: Copy = { ar: 'قريبًا', en: 'Coming soon' };

/** The top bar's labelled language pill (as LanguageToggle in the suite). */
const LANGUAGE_PILL =
  'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3 text-[14.5px] font-medium text-text no-underline hover:bg-surface-hover md:min-h-11 md:px-4';

/** The shortcuts the product has (the same list as the suite's account menu). */
export const DEMO_SHORTCUTS: readonly { readonly label: Copy; readonly keys: readonly string[] }[] =
  [
    { label: { ar: 'البحث في الصفحات', en: 'Search pages' }, keys: ['Ctrl', 'K'] },
    {
      label: { ar: 'إغلاق اللوحة أو القائمة أو النافذة', en: 'Close a panel, menu or dialog' },
      keys: ['Esc'],
    },
    { label: { ar: 'التنقل بين الصفوف', en: 'Move between rows' }, keys: ['↑', '↓'] },
    { label: { ar: 'فتح الصف المحدد', en: 'Open the selected row' }, keys: ['↵'] },
  ];

function demoNavigation(globals: Globals, current: DemoPage) {
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
                current={entry.key === current}
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

export function DemoShell({
  globals,
  collapsed = false,
  current,
  children,
}: {
  readonly globals: Globals;
  readonly collapsed?: boolean;
  readonly current: DemoPage;
  /** The page's title (the page header shows it since direction C; kept for the stories' readability). */
  readonly title?: Copy;
  readonly children: ReactNode;
}) {
  return (
    <AppShell
      brand={pick(globals, { ar: 'جدارات · التدريب', en: 'Jadarat TMS' })}
      organization={pick(globals, { ar: 'شركة الراية', en: 'Al Raya Company' })}
      organizationInitials={pick(globals, { ar: 'ش', en: 'AR' })}
      organizationDetail={pick(globals, { ar: 'مدير المنظمة', en: 'Organization Admin' })}
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
            hints: {
              navigate: pick(globals, { ar: 'للتنقل', en: 'to navigate' }),
              open: pick(globals, { ar: 'للفتح', en: 'to open' }),
              close: pick(globals, { ar: 'للإغلاق', en: 'to close' }),
            },
          }}
          onNavigate={() => undefined}
        />
      }
      headerEnd={
        <>
          <ThemeMenu
            initial="light"
            texts={{
              label: pick(globals, { ar: 'المظهر', en: 'Theme' }),
              light: pick(globals, { ar: 'فاتح', en: 'Light' }),
              dark: pick(globals, { ar: 'داكن', en: 'Dark' }),
              system: pick(globals, { ar: 'حسب النظام', en: 'System' }),
            }}
          />
          <a
            href="#language"
            hrefLang={pick(globals, { ar: 'en', en: 'ar' })}
            lang={pick(globals, { ar: 'en', en: 'ar' })}
            className={LANGUAGE_PILL}
          >
            <Icon name="globe" className="size-[18px]" />
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
          <UserMenu
            name={pick(globals, { ar: 'منيرة القحطاني', en: 'Munira Alqahtani' })}
            subtitle={pick(globals, {
              ar: 'شركة الراية · مدير المنظمة',
              en: 'Al Raya Company · Organization Admin',
            })}
            profileHref="#profile"
            texts={{
              profile: pick(globals, { ar: 'ملفي الشخصي', en: 'My profile' }),
              signOut: pick(globals, { ar: 'تسجيل الخروج', en: 'Sign out' }),
            }}
            onSignOut={() => Promise.resolve()}
            shortcuts={{
              title: pick(globals, { ar: 'اختصارات لوحة المفاتيح', en: 'Keyboard shortcuts' }),
              closeLabel: pick(globals, { ar: 'إغلاق', en: 'Close' }),
              items: DEMO_SHORTCUTS.map((item) => ({
                label: pick(globals, item.label),
                keys: item.keys,
              })),
            }}
          />
        </>
      }
      navigation={demoNavigation(globals, current)}
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
      {children}
    </AppShell>
  );
}
