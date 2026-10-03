import type { Meta, StoryObj } from '@storybook/react-vite';
import { pick } from '../.storybook/l10n';
import { Badge, type BadgeTone } from './badge';

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Session statuses (glossary #70). */
const STATUSES: { tone: BadgeTone; ar: string; en: string }[] = [
  { tone: 'neutral', ar: 'مسودة', en: 'Draft' },
  { tone: 'info', ar: 'مجدولة', en: 'Scheduled' },
  { tone: 'success', ar: 'مؤكدة', en: 'Confirmed' },
  { tone: 'info', ar: 'جارية', en: 'In progress' },
  { tone: 'success', ar: 'مكتملة', en: 'Completed' },
  { tone: 'danger', ar: 'ملغاة', en: 'Cancelled' },
  { tone: 'warning', ar: 'مؤجلة', en: 'Postponed' },
];

export const SessionStatuses: Story = {
  render: (_args, { globals }) => (
    <div className="flex flex-wrap gap-2">
      {STATUSES.map(({ tone, ar, en }) => (
        <Badge key={en} tone={tone}>
          {pick(globals, { ar, en })}
        </Badge>
      ))}
    </div>
  ),
};
