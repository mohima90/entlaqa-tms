import type { Meta, StoryObj } from '@storybook/react-vite';
import { pick } from '../.storybook/l10n';
import { AppShell } from './app-shell';
import { Card } from './card';

const meta = {
  title: 'Layout/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    brand: '',
    navigation: null,
    navigationLabel: '',
    skipToContentLabel: '',
    children: null,
  },
  render: (_args, { globals }) => (
    <AppShell
      brand={pick(globals, { ar: 'جدارات · التدريب', en: 'Jadarat · Training' })}
      headerEnd={
        <span>{pick(globals, { ar: 'المنشأة: إنطلاقة', en: 'Organization: ENTLAQA' })}</span>
      }
      navigation={
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          <li>
            <a href="#home">{pick(globals, { ar: 'الرئيسية', en: 'Home' })}</a>
          </li>
          <li>
            <a href="#courses">{pick(globals, { ar: 'الدورات', en: 'Courses' })}</a>
          </li>
        </ul>
      }
      navigationLabel={pick(globals, { ar: 'التنقل الرئيسي', en: 'Main navigation' })}
      skipToContentLabel={pick(globals, { ar: 'تخطَّ إلى المحتوى', en: 'Skip to content' })}
    >
      <h1 className="mt-0">{pick(globals, { ar: 'الرئيسية', en: 'Home' })}</h1>
      <Card title={pick(globals, { ar: 'لا توجد بيانات تدريب بعد', en: 'No training data yet' })}>
        {pick(globals, {
          ar: 'ستظهر هنا الجلسات والدورات بعد إعداد وحدة التدريب لمنشأتكم.',
          en: 'Sessions and courses will appear here once the Training module is set up for your organization.',
        })}
      </Card>
    </AppShell>
  ),
};
