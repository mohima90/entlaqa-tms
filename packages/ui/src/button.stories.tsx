import type { Meta, StoryObj } from '@storybook/react-vite';
import { pick } from '../.storybook/l10n';
import { Button, type ButtonSize, type ButtonVariant } from './button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

const VARIANTS: { variant: ButtonVariant; ar: string; en: string }[] = [
  { variant: 'primary', ar: 'حفظ', en: 'Save' },
  { variant: 'secondary', ar: 'حفظ كمسودة', en: 'Save as draft' },
  { variant: 'ghost', ar: 'رفض', en: 'Reject' },
  { variant: 'danger', ar: 'إلغاء الجلسة', en: 'Cancel session' },
  { variant: 'danger-outline', ar: 'تعطيل المستخدم', en: 'Deactivate user' },
];

export const Variants: Story = {
  render: (_args, { globals }) => (
    <div className="flex flex-wrap gap-3">
      {VARIANTS.map(({ variant, ar, en }) => (
        <Button key={variant} variant={variant}>
          {pick(globals, { ar, en })}
        </Button>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (_args, { globals }) => (
    <div className="flex flex-wrap items-center gap-3">
      {(['sm', 'md', 'lg'] as ButtonSize[]).map((size) => (
        <Button key={size} size={size}>
          {pick(globals, { ar: 'تسجيل', en: 'Enroll' })} ({size})
        </Button>
      ))}
    </div>
  ),
};

export const Disabled: Story = {
  render: (_args, { globals }) => (
    <Button disabled>{pick(globals, { ar: 'موافقة', en: 'Approve' })}</Button>
  ),
};
