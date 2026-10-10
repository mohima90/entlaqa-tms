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
});
