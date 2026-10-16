// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  NotificationBell,
  THEME_COOKIE,
  ThemeMenu,
  UserMenu,
} from './index';

let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  delete document.documentElement.dataset.theme;
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

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

/** Radix menus open from the keyboard like a menu button (Enter / Space / ArrowDown). */
function openMenu(triggerId: string) {
  const trigger = byTestId(triggerId);
  trigger.focus();
  press(trigger, 'Enter');
  return trigger;
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');

describe('ThemeMenu (light / dark / system, Kawadir)', () => {
  const texts = { label: 'Theme', light: 'Light', dark: 'Dark', system: 'System' };

  it('names the button after the current mode and lists the three modes as radio items', () => {
    mount(<ThemeMenu initial="system" texts={texts} />);
    const trigger = openMenu('theme-menu');
    expect(trigger.getAttribute('aria-label')).toBe('Theme: System');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menu()?.getAttribute('aria-label')).toBe('Theme');
    const radios = [...document.querySelectorAll('[role="menuitemradio"]')];
    expect(radios.map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['Light', 'false'],
      ['Dark', 'false'],
      ['System', 'true'],
    ]);
  });

  it('applies the chosen mode at once and remembers it on this device', () => {
    mount(<ThemeMenu initial="light" texts={texts} />);
    openMenu('theme-menu');
    act(() => {
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[1]!.click();
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(byTestId('theme-menu').getAttribute('aria-label')).toBe('Theme: Dark');
    openMenu('theme-menu');
    act(() => {
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[2]!.click();
    });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(byTestId('theme-menu').getAttribute('aria-label')).toBe('Theme: System');
  });
});

describe('NotificationBell (placeholder until FR-NTF-01)', () => {
  const texts = { label: 'Notifications', emptyTitle: 'All caught up', emptyBody: 'Nothing yet.' };

  it('is a disclosure button over a panel that says there is nothing yet', () => {
    mount(<NotificationBell texts={texts} />);
    const bell = byTestId('notification-bell');
    const panel = document.getElementById(bell.getAttribute('aria-controls')!)!;
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    act(() => {
      bell.click();
    });
    expect(bell.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('h2')?.textContent).toBe('Notifications');
    expect(panel.querySelector('h3')?.textContent).toBe('All caught up');
    act(() => {
      bell.click();
    });
    expect(panel.hidden).toBe(true);
  });

  it('closes with Escape (focus back on the bell) or a click outside, not a click inside', () => {
    const container = mount(
      <>
        <p>Outside</p>
        <NotificationBell texts={texts} />
      </>,
    );
    const bell = byTestId('notification-bell');
    const panel = document.getElementById(bell.getAttribute('aria-controls')!)!;
    act(() => {
      bell.click();
    });
    press(document, 'Tab');
    expect(panel.hidden).toBe(false);
    document.body.focus();
    press(document, 'Escape');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(bell);
    act(() => {
      bell.click();
    });
    act(() => {
      panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(panel.hidden).toBe(false);
    act(() => {
      container
        .querySelector('p')!
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(panel.hidden).toBe(true);
  });
});

describe('UserMenu (avatar menu, Kawadir)', () => {
  const base = {
    name: 'Mona Saeed',
    subtitle: 'Al Raya · Organization admin',
    profileHref: '/en/suite/profile',
  } as const;

  it('shows the avatar, name and "Organization · Role" on the button', () => {
    const html = renderToStaticMarkup(<UserMenu {...base} texts={{ profile: 'My profile' }} />);
    expect(html).toContain('data-testid="account-menu"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('>MS<');
    expect(html).toContain('Mona Saeed');
    expect(html).toContain('Al Raya · Organization admin');
  });

  it('links to My profile (marked current on that page) and has no sign-out without one', () => {
    mount(<UserMenu {...base} profileCurrent texts={{ profile: 'My profile' }} />);
    openMenu('account-menu');
    const link = byTestId('my-profile-link');
    expect(link.getAttribute('role')).toBe('menuitem');
    expect(link.getAttribute('href')).toBe('/en/suite/profile');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(menu()?.textContent).toContain('Al Raya · Organization admin');
    expect(document.querySelector('[data-testid="sign-out"]')).toBeNull();
  });

  it('signs out through the server action, showing progress meanwhile', async () => {
    let finish: () => void = () => undefined;
    const onSignOut = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mount(
      <UserMenu
        {...base}
        texts={{ profile: 'My profile', signOut: 'Sign out', signingOut: 'Signing out…' }}
        onSignOut={onSignOut}
      />,
    );
    openMenu('account-menu');
    expect(byTestId('my-profile-link').hasAttribute('aria-current')).toBe(false);
    const signOut = byTestId('sign-out');
    expect(signOut.className).toContain('text-danger');
    expect(signOut.textContent).toBe('Sign out');
    await act(async () => {
      signOut.click();
      await Promise.resolve();
    });
    expect(onSignOut).toHaveBeenCalledTimes(1);
    // The menu stays open (the item prevents the default close) and says it is signing out.
    expect(byTestId('sign-out').textContent).toBe('Signing out…');
    expect(byTestId('sign-out').getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(byTestId('sign-out').textContent).toBe('Sign out');
  });

  it('falls back to the sign-out label while pending without a progress text', async () => {
    mount(
      <UserMenu
        {...base}
        texts={{ profile: 'My profile', signOut: 'Sign out' }}
        onSignOut={() => new Promise<void>(() => undefined)}
      />,
    );
    openMenu('account-menu');
    await act(async () => {
      byTestId('sign-out').click();
      await Promise.resolve();
    });
    expect(byTestId('sign-out').textContent).toBe('Sign out');
    expect(byTestId('sign-out').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('DropdownMenu primitives', () => {
  it('renders a non-modal menu with a label and items, aligned to the end by default', () => {
    mount(
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="more">More</DropdownMenuTrigger>
        <DropdownMenuContent className="w-40">
          <DropdownMenuLabel className="extra">Actions</DropdownMenuLabel>
          <DropdownMenuItem>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    openMenu('more');
    const content = menu()!;
    expect(content.className).toContain('w-40');
    expect(content.className).toContain('rounded-xl');
    const label = [...content.children].find((el) => el.textContent === 'Actions')!;
    expect(label.className).toContain('extra');
    expect(label.className).toContain('text-text-muted');
    const item = content.querySelector('[role="menuitem"]')!;
    expect(item.className).not.toContain('text-danger');
    // Non-modal: the rest of the page is not hidden from assistive technology.
    expect(document.body.querySelector('[aria-hidden="true"] [data-testid="more"]')).toBeNull();
  });
});
