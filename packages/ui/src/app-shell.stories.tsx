import type { Meta, StoryObj } from '@storybook/react-vite';
import { pick } from '../.storybook/l10n';
import { AppShell } from './app-shell';
import { Card } from './card';
import { Icon } from './icons';
import { NavGroup, NavItem, NavUnavailable } from './nav-item';

/**
 * The suite shell of the approved design (T-M2-21): gradient navigation with the organization block,
 * grouped entries with icons, a white top bar. Narrow the window below 900 px for the menu button and
 * the navigation drawer (Escape closes it). Tagged `brand-matrix`: the story gate also runs it with
 * organization colours, whose gradient replaces the Jadarat one (FR-ADM-07).
 */
const meta = {
  title: 'Layout/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  tags: ['brand-matrix'],
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    brand: '',
    navigation: null,
    navigationLabel: '',
    skipToContentLabel: '',
    menuLabel: '',
    closeMenuLabel: '',
    children: null,
  },
  render: (_args, { globals }) => (
    <AppShell
      brand={pick(globals, { ar: 'جدارات · التدريب', en: 'Jadarat TMS' })}
      organization={pick(globals, { ar: 'شركة الراية', en: 'Al Raya Company' })}
      headerEnd={
        <a
          href="#language"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-text-muted no-underline hover:bg-surface-hover"
        >
          <Icon name="globe" />
          {pick(globals, { ar: 'English', en: 'العربية' })}
        </a>
      }
      navigation={
        <>
          <NavGroup>
            <li>
              <NavItem href="#home" current icon={<Icon name="home" />}>
                {pick(globals, { ar: 'الرئيسية', en: 'Home' })}
              </NavItem>
            </li>
          </NavGroup>
          <NavGroup id="story-nav-people" heading={pick(globals, { ar: 'الأشخاص', en: 'People' })}>
            <li>
              <NavItem href="#users" icon={<Icon name="people" />} count="12">
                {pick(globals, { ar: 'المستخدمون', en: 'Users' })}
              </NavItem>
            </li>
            <li>
              <NavItem href="#roles" icon={<Icon name="key" />}>
                {pick(globals, { ar: 'الأدوار والصلاحيات', en: 'Roles & permissions' })}
              </NavItem>
            </li>
          </NavGroup>
          <NavGroup
            id="story-nav-integrations"
            heading={pick(globals, { ar: 'التكاملات', en: 'Integrations' })}
          >
            <li>
              <NavUnavailable
                icon={<Icon name="plug" />}
                label={pick(globals, { ar: 'ربط نظام إدارة التعلّم', en: 'LMS connection' })}
                note={pick(globals, { ar: 'قريبًا', en: 'Coming soon' })}
              />
            </li>
          </NavGroup>
        </>
      }
      navigationLabel={pick(globals, { ar: 'التنقل الرئيسي', en: 'Main navigation' })}
      skipToContentLabel={pick(globals, { ar: 'تخطَّ إلى المحتوى', en: 'Skip to content' })}
      menuLabel={pick(globals, { ar: 'القائمة', en: 'Menu' })}
      closeMenuLabel={pick(globals, { ar: 'إغلاق القائمة', en: 'Close menu' })}
    >
      <h1 className="mt-0 text-2xl font-semibold">
        {pick(globals, { ar: 'الرئيسية', en: 'Home' })}
      </h1>
      <Card title={pick(globals, { ar: 'لا توجد بيانات تدريب بعد', en: 'No training data yet' })}>
        {pick(globals, {
          ar: 'ستظهر هنا الجلسات والدورات بعد إعداد وحدة التدريب لمنشأتكم.',
          en: 'Sessions and courses will appear here once the Training module is set up for your organization.',
        })}
      </Card>
    </AppShell>
  ),
};
