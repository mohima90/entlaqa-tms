// @vitest-environment happy-dom
import { type ReactNode, act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FilterPill,
  ListCard,
  ListCards,
  Pagination,
  SaveBar,
  SidePanel,
  SortHeader,
  TableSkeleton,
  UserMenu,
  ViewCards,
} from './index';

/** Direction C building blocks (redesign package 1): markup, states and keyboard behaviour. */
let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mount(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(ui));
  return container;
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

/** The native `close` event is queued as a task; let it run. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const VIEWS = [
  { key: 'all', href: '/users', label: 'All', count: '42' },
  { key: 'active', href: '/users?tab=active', label: 'Active', count: '35' },
  { key: 'invited', href: '/users?tab=invited', label: 'Pending invites', count: '5' },
  { key: 'deactivated', href: '/users?tab=deactivated', label: 'Deactivated', count: '2' },
] as const;

describe('ViewCards (saved views with big numbers)', () => {
  it('is a navigation of links, one per view, the current one marked and on the brand gradient', () => {
    const container = mount(
      <ViewCards label="Team members views" current="active" items={VIEWS} />,
    );
    const nav = container.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Team members views');
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(VIEWS.map((v) => v.href));
    const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]?.className).toContain('bg-stat-gradient');
    expect(current[0]?.className).toContain('text-on-brand');
    // The status and its count are one link text ("Active 35"), the count in large tabular figures.
    expect(current[0]?.textContent).toBe('Active 35');
    expect(current[0]?.querySelector('.tabular-nums')?.className).toContain('text-[28px]');
    expect(links[0]?.className).toContain('bg-surface');
  });

  it('shows two cards per row on a phone and four from a wide screen', () => {
    const html = renderToStaticMarkup(<ViewCards label="v" current="all" items={VIEWS} />);
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('xl:grid-cols-4');
  });
});

describe('list patterns', () => {
  it('a filter pill: dashed with «+» until used, solid with «×» and a remove name once set', () => {
    const unset = renderToStaticMarkup(<FilterPill href="#unit" label="Unit" />);
    expect(unset).toContain('border-dashed');
    expect(unset).not.toContain('aria-label');
    const set = renderToStaticMarkup(
      <FilterPill
        href="/users"
        label="Role"
        value="Training Coordinator"
        removeLabel="Remove the filter Role: Training Coordinator"
      />,
    );
    expect(set).toContain('aria-label="Remove the filter Role: Training Coordinator"');
    expect(set).toContain('bg-primary-subtle');
    expect(set.replace(/<!-- -->/g, '')).toContain('Role: Training Coordinator');
  });

  it('a sortable column says its order (aria-sort) and links to the other order', () => {
    const html = renderToStaticMarkup(
      <table>
        <thead>
          <tr>
            <SortHeader label="Name" sort="ascending" href="?sort=-name" />
            <SortHeader label="Unit" href="?sort=unit" />
          </tr>
        </thead>
      </table>,
    );
    expect(html).toMatch(/<th scope="col" aria-sort="ascending"><a href="\?sort=-name"/);
    expect(html).toContain('aria-sort="none"');
  });

  it('pagination: the range in words, a missing page shown as an unavailable link', () => {
    const html = renderToStaticMarkup(
      <Pagination
        label="Pagination"
        range="Showing 1–8 of 42"
        previous={{ href: null, label: 'Previous' }}
        next={{ href: '?page=2', label: 'Next' }}
      />,
    );
    expect(html).toContain('<nav aria-label="Pagination"');
    expect(html).toContain('Showing 1–8 of 42');
    expect(html).toMatch(/<span role="link" aria-disabled="true"[^>]*>.*Previous<\/span>/);
    expect(html).toMatch(/<a href="\?page=2"[^>]*>Next/);
  });

  it('loading rows are decorative, with one status line for screen readers', () => {
    const html = renderToStaticMarkup(<TableSkeleton rows={2} label="Loading…" />);
    expect(html).toMatch(/^<div role="status"><span class="sr-only">Loading…<\/span>/);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html).toContain('skeleton');
  });
});

const SAVE_TEXTS = {
  unsaved: 'You have unsaved changes.',
  saving: 'Saving…',
  saved: 'Last changed by Mona',
  save: 'Save changes',
  cancel: 'Cancel',
} as const;

describe('SaveBar (floating save bar)', () => {
  it('unsaved: a dark pill whose status says so; Cancel resets and Save submits the form by id', () => {
    const container = mount(<SaveBar state="unsaved" form="settings" texts={SAVE_TEXTS} />);
    const bar = byTestId('save-bar');
    expect(bar.dataset.state).toBe('unsaved');
    expect(bar.className).toContain('bg-inverse-surface');
    expect(container.querySelector('[role="status"]')?.textContent).toBe(SAVE_TEXTS.unsaved);
    const [cancel, save] = [...container.querySelectorAll('button')];
    expect([cancel?.type, cancel?.getAttribute('form'), cancel?.disabled]).toEqual([
      'reset',
      'settings',
      false,
    ]);
    expect([save?.type, save?.getAttribute('form')]).toEqual(['submit', 'settings']);
  });

  it('saving marks Save busy; at rest it says who changed the settings last', () => {
    const saving = renderToStaticMarkup(
      <SaveBar state="saving" form="settings" texts={SAVE_TEXTS} />,
    );
    expect(saving).toContain('aria-busy="true"');
    expect(saving).toContain(SAVE_TEXTS.saving);
    const saved = mount(<SaveBar state="saved" form="settings" texts={SAVE_TEXTS} />);
    expect(saved.querySelector('[role="status"]')?.textContent).toBe(SAVE_TEXTS.saved);
    // At rest there is nothing to cancel: only Save, as a quiet (secondary) button.
    expect(saved.querySelector('button[type="reset"]')).toBeNull();
    expect(saved.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it('invalid: says fields need correcting and offers the way to the first one (package 2)', () => {
    const fix = vi.fn();
    const container = mount(
      <SaveBar
        state="invalid"
        form="settings"
        texts={{ ...SAVE_TEXTS, invalid: 'Some fields need correcting.' }}
        fix={{ label: 'Go to Industry', onClick: fix }}
      />,
    );
    expect(byTestId('save-bar').dataset.state).toBe('invalid');
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Some fields need correcting.',
    );
    act(() => {
      byTestId('save-bar-fix').click();
    });
    expect(fix).toHaveBeenCalledTimes(1);
    expect(byTestId('save-bar-save').getAttribute('type')).toBe('submit');
  });
});

function PanelHarness({ onClose }: { readonly onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Edit unit
      </button>
      <SidePanel
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Edit unit"
        description="Talent Development"
        closeLabel="Close"
        footer={<button type="button">Save</button>}
        data-testid="unit-panel"
      >
        <input aria-label="Name" />
      </SidePanel>
    </>
  );
}

describe('SidePanel', () => {
  it('opens as a modal at the inline end, named and described, and gives focus back on close', async () => {
    const onClose = vi.fn();
    const container = mount(<PanelHarness onClose={onClose} />);
    const opener = container.querySelector('button')!;
    opener.focus();
    act(() => {
      opener.click();
    });
    const panel = byTestId('unit-panel') as HTMLDialogElement;
    expect(panel.open).toBe(true);
    expect(panel.className).toContain('end-2.5');
    expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Edit unit',
    );
    expect(document.getElementById(panel.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Talent Development',
    );
    act(() => {
      panel.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    });
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });
});

describe('the keyboard shortcuts list (account menu)', () => {
  function press(target: EventTarget, key: string) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
  }

  it('opens from the account menu as a dialog listing the shortcuts; closing returns to the menu button', async () => {
    mount(
      <UserMenu
        name="Mona Saeed"
        subtitle="Al Raya · Organization admin"
        profileHref="/en/suite/profile"
        texts={{ profile: 'My profile' }}
        shortcuts={{
          title: 'Keyboard shortcuts',
          closeLabel: 'Close',
          items: [
            { label: 'Search pages', keys: ['Ctrl', 'K'] },
            { label: 'Close a panel, menu or dialog', keys: ['Esc'] },
          ],
        }}
      />,
    );
    const trigger = byTestId('account-menu');
    trigger.focus();
    press(trigger, 'Enter');
    const item = byTestId('shortcuts-open');
    expect(item.getAttribute('role')).toBe('menuitem');
    expect(item.textContent).toBe('Keyboard shortcuts');
    act(() => {
      item.click();
    });
    const dialog = byTestId('shortcuts-dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelectorAll('dt')).toHaveLength(2);
    expect([...dialog.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual([
      'Ctrl',
      'K',
      'Esc',
    ]);
    // Keys are printed left to right in both languages.
    expect(dialog.querySelector('dd')?.getAttribute('dir')).toBe('ltr');
    act(() => {
      dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    });
    await flush();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('ListCard (redesign package 5)', () => {
  it('passes test ids and data attributes to its row, so a phone card can be found like a table row', () => {
    const html = renderToStaticMarkup(
      <ListCards>
        <ListCard data-testid="organization-card" data-slug="demo-org" title="Demo" />
      </ListCards>,
    );
    expect(html).toContain('data-testid="organization-card"');
    expect(html).toContain('data-slug="demo-org"');
    expect(html).toContain('Demo');
  });
});
