import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Badge } from './badge';
import { ChecklistAccordion, type ChecklistGroup } from './checklist-accordion';

/**
 * Checkboxes grouped by module with a «ticked / total» badge (Kawadir's permissions accordion; EP-ROLES
 * role builder). Native details/summary and checkboxes; a disabled item says why.
 */
const meta = {
  title: 'Patterns/Checklist accordion',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const pick = (globals: Record<string, unknown>, text: { ar: string; en: string }) =>
  globals.locale === 'en' ? text.en : text.ar;

function groupsFor(
  globals: Record<string, unknown>,
  checked: ReadonlySet<string>,
): ChecklistGroup[] {
  const high = (
    <Badge tone="warning">{pick(globals, { ar: 'عالي الخطورة', en: 'High risk' })}</Badge>
  );
  return [
    {
      key: 'people',
      title: pick(globals, { ar: 'الأشخاص', en: 'People' }),
      items: [
        {
          value: 'platform.user.read',
          label: pick(globals, { ar: 'عرض المستخدمين', en: 'View users' }),
          description: pick(globals, {
            ar: 'عرض المستخدمين وملفاتهم ضمن النطاق',
            en: 'View users and their profiles within scope',
          }),
          checked: checked.has('platform.user.read'),
        },
        {
          value: 'platform.user.invite',
          label: pick(globals, { ar: 'دعوة المستخدمين', en: 'Invite users' }),
          checked: checked.has('platform.user.invite'),
          disabled: true,
          note: pick(globals, {
            ar: 'لدور يرى المنظمة كلها فقط.',
            en: 'Only for a role that sees the whole organization.',
          }),
        },
      ],
    },
    {
      key: 'audit',
      title: pick(globals, { ar: 'سجل التدقيق', en: 'Audit log' }),
      items: [
        {
          value: 'platform.audit.read',
          label: pick(globals, { ar: 'عرض سجل التدقيق', en: 'View the audit log' }),
          badge: high,
          checked: checked.has('platform.audit.read'),
        },
      ],
    },
  ];
}

function Demo({ globals, readOnly }: { globals: Record<string, unknown>; readOnly: boolean }) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(['platform.user.read']));
  return (
    <div className="max-w-2xl bg-bg">
      <ChecklistAccordion
        groups={groupsFor(globals, checked)}
        readOnly={readOnly}
        defaultOpen="all"
        onToggle={(value, on) => {
          setChecked((current) => {
            const next = new Set(current);
            if (on) next.add(value);
            else next.delete(value);
            return next;
          });
        }}
        countLabel={pick(globals, {
          ar: '{checked} من {total} محددة',
          en: '{checked} of {total} selected',
        })}
        idPrefix={readOnly ? 'story-view' : 'story-edit'}
      />
    </div>
  );
}

/** Tick and clear permissions; the badge counts per module. */
export const Editable: Story = {
  render: (_args, { globals }) => <Demo globals={globals} readOnly={false} />,
};

/** A standard role: shown, not changeable. */
export const ReadOnly: Story = {
  render: (_args, { globals }) => <Demo globals={globals} readOnly />,
};
