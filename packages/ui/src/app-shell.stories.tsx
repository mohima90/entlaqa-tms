import type { Meta, StoryObj } from '@storybook/react-vite';
import { DemoShell } from '../.storybook/demo-shell';
import { pick } from '../.storybook/l10n';
import { AppShell } from './app-shell';
import { PageHeader } from './page-header';
import { StatCard, StatGrid } from './stat-card';

/**
 * The suite shell in the Kawadir layout (T-M2-43; docs/design/kawadir-alignment.md §3): a white
 * navigation (the organization's logo — or its name as a wordmark — on top, grouped entries, the current
 * one on the Jadarat brand gradient, «Powered by Jadarat») that collapses from 260 to 72 px on a desktop,
 * and a sticky top bar on the page background with the page title, the ⌘K / Ctrl K search pill, theme,
 * language (globe), notifications and the account chip. Narrow the window below 900 px for the menu
 * button and the drawer (Escape closes it). Tagged `brand-matrix`: the story gate also runs it with
 * organization colours, whose gradient replaces the Jadarat one on the current entry (FR-ADM-07).
 */
const meta = {
  title: 'Layout/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen', frame: 'bare' },
  tags: ['brand-matrix'],
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;

type Globals = Record<string, unknown>;

function Content({ globals }: { globals: Globals }) {
  return (
    <>
      <PageHeader
        title={pick(globals, { ar: 'أعضاء الفريق', en: 'Team members' })}
        description={pick(globals, {
          ar: 'أعضاء منشأتكم وأدوارهم والدعوات المعلّقة.',
          en: 'The people of your organization, their roles and pending invitations.',
        })}
      />
      <StatGrid label={pick(globals, { ar: 'ملخص', en: 'Summary' })}>
        <StatCard
          variant="gradient"
          label={pick(globals, { ar: 'إجمالي الأعضاء', en: 'Total members' })}
          value="128"
          icon="people"
        />
        <StatCard
          variant="gradient"
          label={pick(globals, { ar: 'نشط', en: 'Active' })}
          value="119"
          icon="success"
        />
        <StatCard
          variant="gradient"
          label={pick(globals, { ar: 'الدعوات المعلّقة', en: 'Pending invites' })}
          value="6"
          icon="mail"
        />
        <StatCard
          variant="gradient"
          label={pick(globals, { ar: 'معطَّل', en: 'Deactivated' })}
          value="3"
          icon="user"
        />
      </StatGrid>
    </>
  );
}

const shellArgs = {
  brand: '',
  navigation: null,
  navigationLabel: '',
  skipToContentLabel: '',
  menuLabel: '',
  closeMenuLabel: '',
  children: null,
} as const;

export const Default: Story = {
  args: shellArgs,
  render: (_args, { globals }) => (
    <DemoShell globals={globals} current="team" title={{ ar: 'أعضاء الفريق', en: 'Team members' }}>
      <Content globals={globals} />
    </DemoShell>
  ),
};

/** Collapsed to icons (desktop): tooltips on hover and focus; the expand button at the bottom. */
export const Collapsed: Story = {
  args: shellArgs,
  render: (_args, { globals }) => (
    <DemoShell
      globals={globals}
      collapsed
      current="team"
      title={{ ar: 'أعضاء الفريق', en: 'Team members' }}
    >
      <Content globals={globals} />
    </DemoShell>
  ),
};
