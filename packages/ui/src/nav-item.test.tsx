import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NavItem, NavUnavailable, navHeadingClasses, navItemClasses } from './index';

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

  it('never uses surface or text utilities that a coloured navigation would make unreadable', () => {
    const classes = [
      navItemClasses({ current: true }),
      navItemClasses({ current: false }),
      navHeadingClasses,
    ].join(' ');
    expect(classes).not.toMatch(/\b(bg-surface|text-text|text-primary-text)\b/);
  });
});
