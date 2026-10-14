import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Icon,
  NavGroup,
  NavItem,
  NavUnavailable,
  navHeadingClasses,
  navItemClasses,
} from './index';

describe('navigation entries (shell roles)', () => {
  it('marks the current page and uses the nav colour roles', () => {
    const current = renderToStaticMarkup(
      <NavItem href="/ar/suite/admin/users" current>
        المستخدمون
      </NavItem>,
    );
    expect(current).toContain('aria-current="page"');
    expect(current).toContain('bg-nav-item-current');
    expect(current).toContain('text-on-nav-item-current');
    const other = renderToStaticMarkup(<NavItem href="/ar/suite">الرئيسية</NavItem>);
    expect(other).not.toContain('aria-current');
    expect(other).toContain('text-on-nav');
    expect(other).toContain('hover:bg-nav-item-hover');
  });

  it('shows unavailable entries as text with their note', () => {
    const html = renderToStaticMarkup(<NavUnavailable label="الجلسات" note="قريبًا" />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('text-on-nav-muted');
    expect(html).toContain('قريبًا');
  });

  it('shows an icon (decorative) and an optional count', () => {
    const html = renderToStaticMarkup(
      <NavItem href="/en/suite/admin/users" icon={<Icon name="people" />} count={7}>
        Users
      </NavItem>,
    );
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
    expect(html).toContain('>7</span>');
    expect(renderToStaticMarkup(<NavItem href="#">Home</NavItem>)).not.toContain('tabular-nums');
  });

  it('gives entries 44 px touch targets below the desktop width and on touch screens', () => {
    for (const classes of [navItemClasses({ current: false }), navItemClasses({ current: true })]) {
      expect(classes).toContain('min-h-11');
      expect(classes).toContain('pointer-coarse:min-h-11');
    }
  });

  it('labels a group list by its heading, and leaves the first group without one', () => {
    const grouped = renderToStaticMarkup(
      <NavGroup id="nav-people" heading="الأشخاص">
        <li>x</li>
      </NavGroup>,
    );
    expect(grouped).toContain('<h2 id="nav-people"');
    expect(grouped).toContain('aria-labelledby="nav-people"');
    const plain = renderToStaticMarkup(
      <NavGroup>
        <li>x</li>
      </NavGroup>,
    );
    expect(plain).not.toContain('<h2');
    expect(plain).not.toContain('aria-labelledby');
  });

  it('never uses surface or text utilities that a coloured navigation would make unreadable', () => {
    const classes = [
      navItemClasses({ current: true }),
      navItemClasses({ current: false }),
      navHeadingClasses,
    ].join(' ');
    expect(classes).not.toMatch(/\b(bg-surface|text-text|text-primary-text)\b/);
  });
});
