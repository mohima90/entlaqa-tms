import type { Meta, StoryObj } from '@storybook/react-vite';
import { pick } from '../.storybook/l10n';
import { TextField } from './text-field';

const meta = {
  title: 'Primitives/TextField',
  component: TextField,
} satisfies Meta<typeof TextField>;
export default meta;
/* Each story renders its own TextField (the label depends on the language), so no shared args. */
type Story = StoryObj;

export const Default: Story = {
  render: (_args, { globals }) => (
    <TextField
      id="course-name"
      label={pick(globals, { ar: 'اسم الدورة بالعربية', en: 'Course name in Arabic' })}
      className="max-w-md"
    />
  ),
};

export const WithHint: Story = {
  render: (_args, { globals }) => (
    <TextField
      id="course-code"
      label={pick(globals, { ar: 'رمز الدورة', en: 'Course code' })}
      hint={pick(globals, { ar: 'مثال: LEAD-101', en: 'Example: LEAD-101' })}
      dir="ltr"
      className="max-w-md"
    />
  ),
};

export const WithError: Story = {
  render: (_args, { globals }) => (
    <TextField
      id="course-name-error"
      label={pick(globals, { ar: 'اسم الدورة بالعربية', en: 'Course name in Arabic' })}
      error={pick(globals, {
        ar: 'اسم الدورة بالعربية مطلوب.',
        en: 'Course name in Arabic is required.',
      })}
      required
      marker={pick(globals, { ar: '(مطلوب)', en: '(required)' })}
      className="max-w-md"
    />
  ),
};

export const EmailLeftToRight: Story = {
  render: (_args, { globals }) => (
    <TextField
      id="email"
      type="email"
      label={pick(globals, { ar: 'البريد الإلكتروني', en: 'Email' })}
      dir="ltr"
      autoComplete="username"
      defaultValue="name@example.com"
      className="max-w-md"
    />
  ),
};

export const Disabled: Story = {
  render: (_args, { globals }) => (
    <TextField
      id="disabled"
      label={pick(globals, { ar: 'رمز الدورة', en: 'Course code' })}
      defaultValue="LEAD-101"
      dir="ltr"
      disabled
      className="max-w-md"
    />
  ),
};
