import { describe, expect, it } from 'vitest';
import { isEmailAddress, maskEmailAddress } from './address';
import { formatEmailDate } from './format';
import { escapeHtml, markup } from './html';

describe('addresses', () => {
  it('checks the syntax strictly enough for message headers', () => {
    for (const ok of ['a@b.co', 'n.aldossari@alraya.example', 'first+tag@sub.example.com']) {
      expect(isEmailAddress(ok)).toBe(true);
    }
    for (const bad of ['', 'a@b', 'a b@c.d', '<a@b.c>', 'a@b.c\nBcc: x@y.z', 'a@-b.c', 'a,b@c.d']) {
      expect(isEmailAddress(bad)).toBe(false);
    }
    expect(isEmailAddress(`${'a'.repeat(65)}@b.co`)).toBe(false);
    // Control and invisible formatting characters (NUL, bidi override, zero-width space).
    for (const bad of ['a\u0000b@example.com', 'ab\u202e@example.com', 'a\u200bb@example.com']) {
      expect(isEmailAddress(bad)).toBe(false);
    }
  });

  it('masks the local part for the delivery log', () => {
    expect(maskEmailAddress('n.aldossari@alraya.example')).toBe('n***@alraya.example');
    expect(maskEmailAddress('broken')).toBe('***');
  });
});

describe('formatting and escaping', () => {
  it('formats a calendar day in the given time zone', () => {
    // 22:30 UTC on 10 October is already 11 October in Riyadh.
    expect(formatEmailDate('2026-10-10T22:30:00Z', 'ar', 'Asia/Riyadh')).toBe(
      'الأحد، 11 أكتوبر 2026',
    );
    expect(formatEmailDate(new Date('2026-10-10T22:30:00Z'), 'en', 'UTC')).toBe(
      'Saturday, 10 October 2026',
    );
  });

  it('escapes interpolations, keeps nested safe HTML and lists', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    const inner = markup`<b>${'<i>'}</b>`;
    expect(markup`<p>${inner}${[inner, inner]}${3}</p>`.value).toBe(
      '<p><b>&lt;i&gt;</b><b>&lt;i&gt;</b><b>&lt;i&gt;</b>3</p>',
    );
  });
});
