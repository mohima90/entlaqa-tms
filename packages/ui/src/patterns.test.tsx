import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  Avatar,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  MAX_TOASTS,
  PageHeader,
  StatCard,
  StatGrid,
  TabNav,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toolbar,
  createToastStore,
  groupItems,
  initialsOf,
  isPaletteShortcut,
  parseNavCollapsed,
  parseThemeMode,
  preferenceCookie,
  themeAttribute,
} from './index';

const PHYSICAL =
  /\b(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-/;

describe('shell preferences (per device, T-M2-43)', () => {
  it('reads the theme cookie, defaulting to the system setting', () => {
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('system')).toBe('system');
    expect(parseThemeMode(undefined)).toBe('system');
    expect(parseThemeMode('"><script>')).toBe('system');
  });

  it('sets data-theme only for an explicit choice (system follows prefers-color-scheme)', () => {
    expect(themeAttribute('dark')).toBe('dark');
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('system')).toBeUndefined();
  });

  it('reads the navigation cookie, expanded by default', () => {
    expect(parseNavCollapsed('collapsed')).toBe(true);
    expect(parseNavCollapsed('expanded')).toBe(false);
    expect(parseNavCollapsed(null)).toBe(false);
  });

  it('writes first-party cookies for a year, Secure on https', () => {
    expect(preferenceCookie('jadarat_theme', 'dark', true)).toBe(
      'jadarat_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    );
    expect(preferenceCookie('jadarat_nav', 'collapsed', false)).not.toContain('Secure');
  });
});

describe('toasts (sonner-style queue)', () => {
  it('queues, dismisses and caps toasts; errors stay until closed', () => {
    const store = createToastStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const saved = store.add('success', 'Saved');
    store.add('error', 'Not saved', { description: 'Try again' });
    expect(store.items().map((t) => [t.tone, t.duration])).toEqual([
      ['success', 6000],
      ['error', null],
    ]);
    store.dismiss(saved);
    expect(store.items()).toHaveLength(1);
    for (let i = 0; i < MAX_TOASTS + 2; i += 1) store.add('info', `n${String(i)}`);
    expect(store.items()).toHaveLength(MAX_TOASTS);
    expect(store.items().at(-1)?.message).toBe(`n${String(MAX_TOASTS + 1)}`);
    store.clear();
    expect(store.items()).toEqual([]);
    unsubscribe();
    const calls = listener.mock.calls.length;
    store.add('default', 'unheard');
    expect(listener.mock.calls.length).toBe(calls);
  });
});

describe('command palette model', () => {
  it('opens with Ctrl+K or ⌘K only', () => {
    expect(isPaletteShortcut({ key: 'k', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: 'K', ctrlKey: false, metaKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: 'k', ctrlKey: false, metaKey: false })).toBe(false);
    expect(isPaletteShortcut({ key: 'j', ctrlKey: true, metaKey: false })).toBe(false);
  });

  it('groups pages like the menu, in first-seen order', () => {
    const groups = groupItems([
      { id: 'home', label: 'Home', group: 'Pages', href: '/en/suite' },
      { id: 'team', label: 'Team members', group: 'Organization', href: '/en/suite/admin/users' },
      { id: 'general', label: 'General', group: 'Settings', href: '/en/suite/admin/settings' },
      { id: 'roles', label: 'Roles', group: 'Organization', href: '/en/suite/admin/roles' },
    ]);
    expect(groups.map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ['Pages', ['home']],
      ['Organization', ['team', 'roles']],
      ['Settings', ['general']],
    ]);
  });
});

describe('Avatar', () => {
  it('shows initials (one Arabic letter, two Latin) and is decorative', () => {
    expect(initialsOf('Mona Saeed Alzahrani')).toBe('MS');
    expect(initialsOf('منيرة القحطاني')).toBe('م');
    expect(initialsOf('  ')).toBe('?');
    expect(renderToStaticMarkup(<Avatar name="Mona" />)).toContain('aria-hidden="true"');
  });

  it('is on the brand gradient by default, soft in list rows, and shows a photo when there is one', () => {
    expect(renderToStaticMarkup(<Avatar name="Mona" />)).toContain('bg-brand-gradient');
    const soft = renderToStaticMarkup(<Avatar name="Mona Saeed" tone="soft" size="md" />);
    expect(soft).toContain('bg-primary-subtle text-primary-text');
    expect(soft).toContain('size-10');
    expect(soft).toContain('>MS<');
    const photo = renderToStaticMarkup(<Avatar name="Mona" src="/p.png" />);
    expect(photo).toMatch(/<img src="\/p.png" alt=""/);
    expect(photo).not.toContain('>M<');
  });
});

describe('page patterns (Kawadir)', () => {
  it('PageHeader renders the page h1, description and actions', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="أعضاء الفريق" description="d" actions={<a href="#i">دعوة</a>} />,
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    // Direction C: a 38 px bold title (28 px on phones).
    expect(html).toContain('md:text-5xl');
    expect(html).toContain('font-bold');
    expect(html).toContain('دعوة');
    expect(html).not.toContain('<nav');
  });

  it('PageHeader shows breadcrumbs with the current page last', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="الإعدادات العامة"
        breadcrumbsLabel="مسار التنقل"
        breadcrumbs={[{ label: 'الإعدادات', href: '#settings' }, { label: 'الإعدادات العامة' }]}
      />,
    );
    expect(html).toContain('<nav aria-label="مسار التنقل"');
    expect(html).toContain('<a href="#settings"');
    expect(html).toMatch(/<span aria-current="page"[^>]*>الإعدادات العامة<\/span>/);
  });

  it('PageHeader sets a dashboard title in the brand gradient', () => {
    const html = renderToStaticMarkup(<PageHeader title="الرئيسية" description="d" gradient />);
    expect(html).toContain('text-brand-gradient');
    expect(html).toContain('md:text-5xl');
  });

  it('Card shows a coloured icon before the title and ties the title to an id', () => {
    const html = renderToStaticMarkup(
      <Card title="المنشأة" description="d" icon="building" titleId="card-org">
        x
      </Card>,
    );
    expect(html).toMatch(/<h2 id="card-org"[^>]*>/);
    expect(html).toMatch(/<svg[^>]*class="[^"]*text-primary-text"[^>]*aria-hidden="true"/);
    expect(renderToStaticMarkup(<Card title="t">x</Card>)).not.toContain('<svg');
  });

  it('StatGrid is a labelled description list of label → figure', () => {
    const html = renderToStaticMarkup(
      <StatGrid label="ملخص">
        <StatCard label="إجمالي الأعضاء" value="12" icon="people" tone="primary" />
        <StatCard label="نشط" value="9" tone="success" hint="h" />
      </StatGrid>,
    );
    expect(html).toContain('<dl aria-label="ملخص"');
    expect(html.match(/<dt/g)).toHaveLength(2);
    expect(html.match(/<dd/g)).toHaveLength(3);
    expect(html).toContain('text-success');
  });

  it('StatCard gradient: KPI card on the brand gradient with icon tile, trend and sparkline', () => {
    const html = renderToStaticMarkup(
      <StatGrid label="ملخص">
        <StatCard
          variant="gradient"
          label="نشط"
          value="19"
          icon="success"
          trend={{ direction: 'up', label: '12% vs previous' }}
          sparkline={[1, 3, 2, 5]}
          hint="h"
        />
        <StatCard variant="gradient" label="brand" value="2" />
      </StatGrid>,
    );
    // Every KPI card is on the brand gradient (an organization's colours recolour it, FR-ADM-07), with
    // the brand gradient's own text colour — never a fixed hue (PO, 16 Oct 2026).
    expect(html.match(/bg-stat-gradient text-on-brand/g)).toHaveLength(2);
    expect(html).not.toMatch(/stat-(violet|green|orange|blue)|text-on-stat/);
    expect(html).toContain('12% vs previous');
    expect(html).toMatch(/<polyline[^>]*points="0.0,/);
    expect(html.match(/<dt/g)).toHaveLength(2);
    // The icon tile and the sparkline are decorative.
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).not.toMatch(PHYSICAL);
  });

  it('StatCard gradient leaves out a sparkline of fewer than two values and an empty trend row', () => {
    const one = renderToStaticMarkup(
      <StatCard variant="gradient" label="l" value="1" sparkline={[4]} />,
    );
    expect(one).not.toContain('<polyline');
    const plain = renderToStaticMarkup(<StatCard variant="gradient" label="l" value="1" />);
    expect(plain.match(/<dd/g)).toHaveLength(1);
    const flat = renderToStaticMarkup(
      <StatCard variant="gradient" label="l" value="1" sparkline={[0, 0]} />,
    );
    expect(flat).toContain('<polyline');
  });

  it('StatCard target: goal, progress bar with its value and words, clamped to 0–100', () => {
    const html = renderToStaticMarkup(
      <StatCard
        variant="target"
        label="Monthly hires"
        value="2"
        target="/ 10"
        progress={20}
        progressLabel="20% complete"
        hint="h"
      />,
    );
    expect(html).toContain('/ 10');
    expect(html).toMatch(
      /role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="20" aria-valuetext="20% complete" aria-label="Monthly hires"/,
    );
    expect(html).toContain('width:20%');
    expect(html).toContain('20% complete');
    const over = renderToStaticMarkup(
      <StatCard variant="target" label={<b>x</b>} value="9" progress={140} />,
    );
    expect(over).toContain('aria-valuenow="100"');
    expect(over).not.toContain('aria-label');
    expect(renderToStaticMarkup(<StatCard variant="target" label="x" value="0" />)).toContain(
      'aria-valuenow="0"',
    );
  });

  it('StatCard plain shows a trend line; StatGrid takes three columns on request', () => {
    const html = renderToStaticMarkup(
      <StatGrid label="s" columns={3}>
        <StatCard label="l" value="1" trend={{ direction: 'down', label: '-2' }} />
        <StatCard label="l" value="1" trend={{ direction: 'flat', label: '0' }} />
      </StatGrid>,
    );
    expect(html).toContain('xl:grid-cols-3');
    expect(html).not.toContain('xl:grid-cols-4');
    expect(html).toContain('-2');
  });

  it('TabNav marks the current view and counts are part of the link text', () => {
    const html = renderToStaticMarkup(
      <TabNav
        label="Views"
        current="invites"
        items={[
          { key: 'members', href: '?tab=members', label: 'Members', count: '12' },
          { key: 'invites', href: '?tab=invites', label: 'Pending invites', count: '3' },
        ]}
      />,
    );
    expect(html).toContain('<nav aria-label="Views"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Pending invites<span[^>]*>\(3\)/);
  });

  it('DataTable has a caption and column headers with scope', () => {
    const html = renderToStaticMarkup(
      <Card title="Members" flush>
        <DataTable caption="Team members">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Mona</TableCell>
            </TableRow>
          </TableBody>
        </DataTable>
      </Card>,
    );
    expect(html).toContain('<caption class="sr-only">Team members</caption>');
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('overflow-hidden');
  });

  it('EmptyState: icon, title, one line and the action', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="لا توجد دعوات معلّقة"
        description="d"
        action={<a href="#invite">دعوة</a>}
      />,
    );
    expect(html).toContain('<h2');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('Dialog is a native dialog named by its title and described by its description', () => {
    const html = renderToStaticMarkup(
      <Dialog open={false} onClose={() => undefined} title="T" description="D" closeLabel="إغلاق">
        body
      </Dialog>,
    );
    const titleId = /<h2 id="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(html).toContain(`aria-labelledby="${titleId}"`);
    expect(html).toMatch(/<dialog[^>]*aria-describedby="[^"]+"/);
    expect(html).toContain('aria-label="إغلاق"');
  });

  it('new patterns use logical utilities only', () => {
    const html = [
      renderToStaticMarkup(<PageHeader title="t" actions={<span />} />),
      renderToStaticMarkup(<Toolbar>x</Toolbar>),
      renderToStaticMarkup(<EmptyState title="t" />),
      renderToStaticMarkup(
        <Dialog open={false} onClose={() => undefined} title="t" closeLabel="c" footer={<b />} />,
      ),
      renderToStaticMarkup(
        <StatGrid label="s">
          <StatCard label="l" value="1" icon="people" />
        </StatGrid>,
      ),
    ].join('');
    expect(html).not.toMatch(PHYSICAL);
  });
});
