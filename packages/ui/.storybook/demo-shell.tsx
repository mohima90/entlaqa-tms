import type { ReactNode } from 'react';
import { AppShell, PoweredBy } from '../src/app-shell';
import { CommandPalette } from '../src/command-palette';
import { Icon, type IconName } from '../src/icons';
import { NavGroup, NavItem, NavUnavailable } from '../src/nav-item';
import { NotificationBell, ThemeMenu, UserMenu } from '../src/shell-controls';
import { type Copy, pick } from './l10n';

/**
 * The suite shell with the Organization Admin's menu and sample data (kawadir-alignment.md §5), for the
 * shell and page stories: the same parts, order and texts as apps/suite/src/components/suite-shell.tsx.
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
      { key: 'security', icon: 'shield', label: { ar: 'الأمان', en: 'Security' } },
    ],
  },
];

const SOON: Copy = { ar: 'قريبًا', en: 'Coming soon' };

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
  title,
  children,
}: {
  readonly globals: Globals;
  readonly collapsed?: boolean;
  readonly current: DemoPage;
  /** The page title in the top bar. */
  readonly title: Copy;
  readonly children: ReactNode;
}) {
  return (
    <AppShell
      brand={pick(globals, { ar: 'جدارات · التدريب', en: 'Jadarat TMS' })}
      organization={pick(globals, { ar: 'شركة الراية', en: 'Al Raya Company' })}
      title={pick(globals, title)}
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
            aria-label={pick(globals, {
              ar: 'التبديل إلى اللغة الإنجليزية',
              en: 'Switch to Arabic',
            })}
            title={pick(globals, { ar: 'English', en: 'العربية' })}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-text-muted no-underline hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          >
            <Icon name="globe" className="size-5" />
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
