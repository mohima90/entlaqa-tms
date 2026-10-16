// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CommandPalette, type CommandPaletteItem, type CommandPaletteTexts } from './index';

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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const texts: CommandPaletteTexts = {
  trigger: 'Search pages…',
  title: 'Search pages',
  placeholder: 'Type a page name',
  empty: 'No pages found',
  close: 'Close',
};

const items: CommandPaletteItem[] = [
  { id: 'home', label: 'Home', group: 'Pages', href: '/en/suite', icon: 'home' },
  { id: 'team', label: 'Team members', group: 'Organization', href: '/en/suite/admin/users' },
  { id: 'roles', label: 'Roles', group: 'Organization', href: '/en/suite/admin/roles' },
];

const trigger = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('[data-testid="command-palette-trigger"]')!;
const dialogOf = (container: HTMLElement) =>
  container.querySelector<HTMLDialogElement>('[data-testid="command-palette"]')!;

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CommandPalette (⌘K / Ctrl K, cmdk)', () => {
  it('renders the search button with the Ctrl shortcut on the server, and no list until opened', () => {
    const html = renderToStaticMarkup(<CommandPalette items={items} texts={texts} />);
    expect(html).toMatch(
      /<button[^>]*aria-haspopup="dialog"[^>]*aria-keyshortcuts="Control\+K Meta\+K"/,
    );
    expect(html).toContain('Search pages…');
    expect(html).toContain('>Ctrl K</kbd>');
    expect(html).toMatch(/<dialog[^>]*aria-label="Search pages"/);
    expect(html).not.toContain('Team members');
  });

  it('shows ⌘ on Apple devices', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
    );
    const container = mount(<CommandPalette items={items} texts={texts} />);
    expect(trigger(container).querySelector('kbd')?.textContent).toBe('⌘ K');
  });

  it('opens from the button as a modal with the search field focused and pages grouped like the menu', () => {
    const container = mount(<CommandPalette items={items} texts={texts} />);
    expect(trigger(container).querySelector('kbd')?.textContent).toBe('Ctrl K');
    act(() => {
      trigger(container).click();
    });
    const dialog = dialogOf(container);
    expect(dialog.open).toBe(true);
    const input = dialog.querySelector('input')!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-label')).toBe('Search pages');
    expect(input.getAttribute('placeholder')).toBe('Type a page name');
    const headings = [...dialog.querySelectorAll('[cmdk-group-heading]')].map((h) => h.textContent);
    expect(headings).toEqual(['Pages', 'Organization']);
    expect([...dialog.querySelectorAll('[cmdk-item]')].map((i) => i.textContent)).toEqual([
      'HomePages',
      'Team membersOrganization',
      'RolesOrganization',
    ]);
  });

  it('filters as you type and says when nothing matches', () => {
    const container = mount(<CommandPalette items={items} texts={texts} />);
    act(() => {
      trigger(container).click();
    });
    const dialog = dialogOf(container);
    const input = dialog.querySelector('input')!;
    typeInto(input, 'roles');
    expect([...dialog.querySelectorAll('[cmdk-item]')].map((i) => i.textContent)).toEqual([
      'RolesOrganization',
    ]);
    typeInto(input, 'zzzz');
    expect(dialog.querySelectorAll('[cmdk-item]')).toHaveLength(0);
    expect(dialog.textContent).toContain('No pages found');
  });

  it('opens the chosen page and closes', async () => {
    const onNavigate = vi.fn();
    const container = mount(<CommandPalette items={items} texts={texts} onNavigate={onNavigate} />);
    act(() => {
      trigger(container).click();
    });
    const dialog = dialogOf(container);
    act(() => {
      [...dialog.querySelectorAll<HTMLElement>('[cmdk-item]')][1]!.click();
    });
    await flush();
    expect(onNavigate).toHaveBeenCalledWith('/en/suite/admin/users');
    expect(dialog.open).toBe(false);
    expect(dialog.querySelector('input')).toBeNull();
  });

  it('navigates the whole page by default', () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const container = mount(<CommandPalette items={items} texts={texts} />);
    act(() => {
      trigger(container).click();
    });
    act(() => {
      dialogOf(container).querySelector<HTMLElement>('[cmdk-item]')!.click();
    });
    expect(assign).toHaveBeenCalledWith('/en/suite');
  });

  it('toggles with Ctrl+K / ⌘K anywhere on the page and returns focus to where it was', async () => {
    const container = mount(
      <>
        <a href="#elsewhere">Elsewhere</a>
        <CommandPalette items={items} texts={texts} />
      </>,
    );
    const link = container.querySelector('a')!;
    link.focus();
    press('k');
    expect(dialogOf(container).open).toBe(false);
    press('k', { ctrlKey: true });
    expect(dialogOf(container).open).toBe(true);
    press('K', { metaKey: true });
    await flush();
    expect(dialogOf(container).open).toBe(false);
    expect(document.activeElement).toBe(link);
  });

  it('closes with its close button and on a click on the backdrop', async () => {
    const container = mount(<CommandPalette items={items} texts={texts} />);
    act(() => {
      trigger(container).click();
    });
    const dialog = dialogOf(container);
    act(() => {
      dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    });
    await flush();
    expect(dialog.open).toBe(false);
    act(() => {
      trigger(container).click();
    });
    act(() => {
      dialog.querySelector('input')!.click();
    });
    expect(dialog.open).toBe(true);
    act(() => {
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(dialog.open).toBe(false);
  });
});
