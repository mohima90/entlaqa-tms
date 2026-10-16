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
});

describe('page patterns (Kawadir)', () => {
  it('PageHeader renders the page h1, description and actions', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="أعضاء الفريق" description="d" actions={<a href="#i">دعوة</a>} />,
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('text-2xl font-bold tracking-tight');
    expect(html).toContain('دعوة');
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
