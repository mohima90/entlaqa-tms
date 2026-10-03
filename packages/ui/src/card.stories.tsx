import type { Meta, StoryObj } from '@storybook/react-vite';
import { pick } from '../.storybook/l10n';
import { Badge } from './badge';
import { Button } from './button';
import { Card } from './card';

const meta = {
  title: 'Primitives/Card',
  component: Card,
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SessionSummary: Story = {
  render: (_args, { globals }) => (
    <Card
      className="max-w-md"
      title={pick(globals, { ar: 'مهارات القيادة', en: 'Leadership skills' })}
    >
      <div className="flex flex-col gap-3">
        <Badge tone="success" className="self-start">
          {pick(globals, { ar: 'مؤكدة', en: 'Confirmed' })}
        </Badge>
        <p className="m-0 text-text-muted">
          {pick(globals, { ar: 'مقعدان متبقيان', en: 'Two seats left' })}
        </p>
        <Button className="self-start">{pick(globals, { ar: 'تسجيل', en: 'Enroll' })}</Button>
      </div>
    </Card>
  ),
};
