import { describe, expect, it } from 'vitest';
import { fillText } from './fill-text';

describe('fillText', () => {
  it('fills names and numbers, leaves unknown placeholders', () => {
    expect(
      fillText('{a} من {b, number, integer} و{c, number}', { a: 'x', b: 12400, c: 2.5 }, 'en'),
    ).toBe('x من 12,400 و2.5');
    expect(fillText('{n, number, integer} صف', { n: 4862 })).toBe(
      `${new Intl.NumberFormat('ar-u-nu-latn').format(4862)} صف`,
    );
    expect(fillText('{missing} {x}', { x: 'y' })).toBe('{missing} y');
  });

  it('chooses simple plural forms with the locale’s rules (reminder chips)', () => {
    const en = '{days, plural, one {# day before} other {# days before}}';
    expect(fillText(en, { days: 1 }, 'en')).toBe('1 day before');
    expect(fillText(en, { days: 7 }, 'en')).toBe('7 days before');
    const ar =
      '{days, plural, one {قبل يوم واحد} two {قبل يومين} few {قبل # أيام} many {قبل # يومًا} other {قبل # يوم}}';
    expect(fillText(ar, { days: 1 }, 'ar')).toBe('قبل يوم واحد');
    expect(fillText(ar, { days: 2 }, 'ar')).toBe('قبل يومين');
    expect(fillText(ar, { days: 7 }, 'ar')).toBe('قبل 7 أيام');
    expect(fillText(ar, { days: 14 }, 'ar')).toBe('قبل 14 يومًا');
    expect(
      fillText(
        '{count, plural, =0 {Deadline today} other {# days left}} — {name}',
        {
          count: 0,
          name: 'Plan',
        },
        'en',
      ),
    ).toBe('Deadline today — Plan');
    // Without a number for it, the form stays as it is.
    expect(fillText(en, {}, 'en')).toBe(en);
  });
});
