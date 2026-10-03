import type { Meta, StoryObj } from '@storybook/react-vite';
import { pick } from '../.storybook/l10n';
import { Alert } from './alert';

const meta = {
  title: 'Primitives/Alert',
  component: Alert,
} satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  render: (_args, { globals }) => (
    <div className="flex max-w-xl flex-col gap-4">
      <Alert tone="info">
        {pick(globals, {
          ar: 'حُفظت الجلسة كمسودة.',
          en: 'Session saved as draft.',
        })}
      </Alert>
      <Alert
        tone="success"
        title={pick(globals, { ar: 'تم تسجيل حضورك.', en: "You're checked in." })}
      >
        {pick(globals, {
          ar: 'نتمنى لك يومًا تدريبيًا مفيدًا.',
          en: 'Have a good training day.',
        })}
      </Alert>
      <Alert tone="warning">
        {pick(globals, { ar: 'مقعدان متبقيان.', en: 'Two seats left.' })}
      </Alert>
      <Alert tone="danger">
        {pick(globals, {
          ar: 'المدرب خالد العتيبي محجوز في الوقت نفسه يوم الاثنين 2 نوفمبر. يمكنك اختيار مدرب متاح أو تغيير الوقت.',
          en: 'Khalid Al-Otaibi is already booked on Mon 2 Nov at this time. Choose an available instructor or change the time.',
        })}
      </Alert>
    </div>
  ),
};
