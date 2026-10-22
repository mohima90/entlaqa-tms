import { describe, expect, it } from 'vitest';
import { type LinkClick, guardedHref } from './leave-guard';

const here = {
  href: 'https://demo.jadarat.example/en/suite/admin/settings',
  origin: 'https://demo.jadarat.example',
  pathname: '/en/suite/admin/settings',
  search: '',
};
const click = (change: Partial<LinkClick>): LinkClick => ({
  defaultPrevented: false,
  button: 0,
  modified: false,
  href: 'https://demo.jadarat.example/en/suite/admin/users',
  target: '',
  download: false,
  ...change,
});

describe('guardedHref (leave guard, Q2-2)', () => {
  it('holds a plain click on another page of the site', () => {
    expect(guardedHref(click({}), here)).toBe('https://demo.jadarat.example/en/suite/admin/users');
    expect(guardedHref(click({ target: '_self' }), here)).not.toBeNull();
    // The language switch: the same page in the other language is another page.
    expect(
      guardedHref(click({ href: 'https://demo.jadarat.example/ar/suite/admin/settings' }), here),
    ).not.toBeNull();
  });

  it('lets through new tabs, downloads, other sites, jumps on the page and handled clicks', () => {
    expect(guardedHref(click({ modified: true }), here)).toBeNull();
    expect(guardedHref(click({ button: 1 }), here)).toBeNull();
    expect(guardedHref(click({ target: '_blank' }), here)).toBeNull();
    expect(guardedHref(click({ download: true }), here)).toBeNull();
    expect(guardedHref(click({ defaultPrevented: true }), here)).toBeNull();
    expect(guardedHref(click({ href: 'https://example.com/' }), here)).toBeNull();
    expect(
      guardedHref(click({ href: 'https://demo.jadarat.example/en/suite/admin/settings#x' }), here),
    ).toBeNull();
  });
});
