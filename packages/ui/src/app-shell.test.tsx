// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, NAV_COOKIE, NavGroup, NavItem, PoweredBy, Tooltip } from './index';

let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** A controllable `(min-width: 900px)` media query: narrow at first. */
let wide: { matches: boolean; listeners: Set<() => void> };
beforeEach(() => {
  wide = { matches: false, listeners: new Set() };
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        media: query,
        get matches() {
          return wide.matches;
        },
        addEventListener: (_: string, listener: () => void) => wide.listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => wide.listeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('dir');
  vi.restoreAllMocks();
});

function mount(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(ui));
  return container;
}

function setWide(matches: boolean) {
  wide.matches = matches;
  act(() => {
    for (const listener of wide.listeners) listener();
  });
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document).dispatchEvent(event);
  });
  return event;
}

const labels = {
  brand: 'Jadarat TMS',
  organization: 'Al Raya',
  navigationLabel: 'Main navigation',
  skipToContentLabel: 'Skip to content',
  menuLabel: 'Menu',
  closeMenuLabel: 'Close menu',
} as const;

function Shell({ collapsible = false, initialCollapsed = false }) {
  return (
    <AppShell
      {...labels}
      organizationInitials="AR"
      organizationDetail="Organization Admin"
      headerStart={<button type="button">Search</button>}
      headerEnd={<span>EN</span>}
      navigation={
        <NavGroup>
          <NavItem href="/en/suite">Home</NavItem>
          <NavItem href="/en/suite/admin/users" current>
            Team members
          </NavItem>
        </NavGroup>
      }
      navigationFooter={<PoweredBy title="Powered by Jadarat" />}
      collapseLabels={
        collapsible ? { collapse: 'Collapse menu', expand: 'Expand menu' } : undefined
      }
      initialCollapsed={initialCollapsed}
    >
      <h1>Team members</h1>
    </AppShell>
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const menuButton = () => q('button[aria-label="Menu"]');
const closeButton = () => q('button[aria-label="Close menu"]');
const drawer = () => q('#app-navigation');
const mainColumn = () => q('main').parentElement!;

function openDrawer() {
  menuButton().focus();
  act(() => {
    menuButton().click();
  });
}

describe('AppShell drawer below 900 px (modal dialog)', () => {
  it('opens as a modal dialog named like the menu button, with focus on its close button', () => {
    mount(<Shell />);
    expect(drawer().hasAttribute('role')).toBe(false);
    openDrawer();
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(drawer().getAttribute('role')).toBe('dialog');
    expect(drawer().getAttribute('aria-modal')).toBe('true');
    expect(drawer().getAttribute('aria-label')).toBe('Menu');
    expect(document.activeElement).toBe(closeButton());
    // The rest of the page, skip link included, is inert; the scrim covers it.
    expect(mainColumn().hasAttribute('inert')).toBe(true);
    expect(q('a[href="#main"]').hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.bg-overlay')).not.toBeNull();
  });

  it('closes with Escape, the close button or the scrim, and returns focus to the menu button', () => {
    mount(<Shell />);
    for (const closeIt of [
      () => press('Escape'),
      () => {
        act(() => {
          closeButton().click();
        });
      },
      () => {
        act(() => {
          q('.bg-overlay').click();
        });
      },
    ]) {
      openDrawer();
      closeIt();
      expect(drawer().hasAttribute('role')).toBe(false);
      expect(mainColumn().hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(menuButton());
    }
  });

  it('keeps Tab and Shift+Tab inside the drawer', () => {
    mount(<Shell />);
    openDrawer();
    const focusable = [
      ...drawer().querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    ];
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    expect(first).toBe(closeButton());
    expect(last.textContent).toBe('Team members');
    // Shift+Tab on the first wraps to the last, Tab on the last wraps to the first.
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    // In between, the browser moves focus as usual.
    focusable[1]!.focus();
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    // Focus that escaped the drawer is brought back in.
    document.body.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
    document.body.focus();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(last);
    // Other keys do nothing.
    expect(press('ArrowDown').defaultPrevented).toBe(false);
    expect(drawer().getAttribute('role')).toBe('dialog');
  });

  it('leaves keys to another modal opened over the drawer', () => {
    const container = mount(<Shell />);
    openDrawer();
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<button type="button">Stay signed in</button>';
    container.append(dialog);
    dialog.showModal();
    dialog.querySelector('button')!.focus();
    press('Escape');
    expect(drawer().getAttribute('role')).toBe('dialog');
  });

  it('gives way to the in-place navigation when the window widens, focus on the current entry', () => {
    mount(<Shell />);
    openDrawer();
    setWide(false);
    expect(drawer().getAttribute('role')).toBe('dialog');
    setWide(true);
    expect(drawer().hasAttribute('role')).toBe(false);
    expect(document.activeElement?.getAttribute('aria-current')).toBe('page');
  });

  it('keeps focus on a navigation entry when widening from inside the drawer', () => {
    mount(<Shell />);
    openDrawer();
    const home = q('nav a[href="/en/suite"]');
    home.focus();
    setWide(true);
    expect(drawer().hasAttribute('role')).toBe(false);
    expect(document.activeElement).toBe(home);
  });
});

describe('AppShell collapse on a desktop (264 → 84 px rail, remembered)', () => {
  it('collapses and expands with one top-bar toggle that keeps focus, and remembers the choice', () => {
    mount(<Shell collapsible />);
    const toggle = q('[data-testid="nav-collapse"]');
    expect(toggle.closest('header')).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse menu');
    expect(toggle.getAttribute('aria-controls')).toBe('app-navigation');
    expect(drawer().className).toContain('lg:w-66');
    expect(document.body.textContent).toContain('Powered by Jadarat');
    toggle.focus();
    act(() => {
      toggle.click();
    });
    expect(drawer().dataset.navCollapsed).toBe('true');
    expect(drawer().className).toContain('lg:w-21');
    expect(document.cookie).toContain(`${NAV_COOKIE}=collapsed`);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand menu');
    expect(document.body.textContent).not.toContain('Powered by Jadarat');
    act(() => {
      toggle.click();
    });
    expect(drawer().hasAttribute('data-nav-collapsed')).toBe(false);
    expect(document.cookie).toContain(`${NAV_COOKIE}=expanded`);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-label')).toBe('Collapse menu');
  });

  it("shows the organization's chip: initials, name and the member's role", () => {
    mount(<Shell collapsible />);
    const chip = q('[data-testid="nav-wordmark"]').parentElement!;
    expect(chip.textContent).toContain('Al Raya');
    expect(chip.textContent).toContain('Organization Admin');
    expect(document.body.textContent).toContain('AR');
  });

  it('shows the labels in the phone drawer even when collapsed on a desktop', () => {
    mount(<Shell collapsible initialCollapsed />);
    expect(drawer().dataset.navCollapsed).toBe('true');
    openDrawer();
    expect(drawer().hasAttribute('data-nav-collapsed')).toBe(false);
  });
});

describe('Tooltip', () => {
  it('opens on keyboard focus with its content, and renders only the child when disabled', () => {
    const container = mount(
      <>
        <Tooltip content="Team members" side="end">
          <button type="button">Icon</button>
        </Tooltip>
        <Tooltip content="never" enabled={false}>
          <button type="button">Plain</button>
        </Tooltip>
      </>,
    );
    const [withTip, plain] = [...container.querySelectorAll('button')];
    expect(plain!.hasAttribute('data-state')).toBe(false);
    act(() => {
      withTip!.focus();
    });
    expect(withTip!.getAttribute('data-state')).toMatch(/open/);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Team members');
    expect(document.body.textContent).not.toContain('never');
  });

  it('places start / end by the document direction (Radix positions physically)', () => {
    const side = () =>
      document
        .querySelector('[data-radix-popper-content-wrapper] [data-side]')
        ?.getAttribute('data-side');
    const cases = [
      ['rtl', 'end', 'left'],
      ['rtl', 'start', 'right'],
      ['ltr', 'end', 'right'],
      ['ltr', 'start', 'left'],
      ['ltr', 'bottom', 'bottom'],
    ] as const;
    for (const [dir, requested, expected] of cases) {
      document.documentElement.dir = dir;
      const container = mount(
        <Tooltip content="tip" side={requested}>
          <button type="button">x</button>
        </Tooltip>,
      );
      act(() => {
        container.querySelector('button')!.focus();
      });
      expect([dir, requested, side()]).toEqual([dir, requested, expected]);
      act(() => root?.unmount());
      root = undefined;
      document.body.innerHTML = '';
    }
  });
});
