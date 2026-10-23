import { describe, expect, it } from 'vitest';
import {
  applyBackspace,
  applyPaste,
  applyTyping,
  digitsOf,
  formatCountdown,
  triesLeftText,
} from './sign-in-code-ui';

describe('digitsOf', () => {
  it('keeps digits of any script and drops the rest', () => {
    expect(digitsOf('12 34-56')).toBe('123456');
    expect(digitsOf('١٢٣٤٥٦')).toBe('123456');
    expect(digitsOf('۱۲۳')).toBe('123');
    expect(digitsOf('abc')).toBe('');
  });
});

describe('applyTyping', () => {
  it('fills the next box and moves on', () => {
    expect(applyTyping('', 0, '4')).toEqual({ value: '4', focus: 1 });
    expect(applyTyping('48', 2, '2')).toEqual({ value: '482', focus: 3 });
  });
  it('replaces the digit of a box that already has one', () => {
    expect(applyTyping('482', 1, '9')).toEqual({ value: '492', focus: 2 });
  });
  it('a box past the end of the code fills the next free one (no gaps)', () => {
    expect(applyTyping('48', 5, '1')).toEqual({ value: '481', focus: 3 });
  });
  it('an auto-filled code arriving whole in one box fills them all, never more than six', () => {
    expect(applyTyping('', 0, '482913')).toEqual({ value: '482913', focus: 5 });
    expect(applyTyping('', 0, '4829135')).toEqual({ value: '482913', focus: 5 });
  });
  it('an emptied box removes its digit', () => {
    expect(applyTyping('4829', 1, '')).toEqual({ value: '429', focus: 1 });
  });
  it('ignores letters', () => {
    expect(applyTyping('48', 2, 'x')).toEqual({ value: '48', focus: 2 });
  });
});

describe('applyPaste', () => {
  it('takes the digits of the clipboard', () => {
    expect(applyPaste(' 482 913 ')).toEqual({ value: '482913', focus: 5 });
    expect(applyPaste('48')).toEqual({ value: '48', focus: 2 });
  });
});

describe('applyBackspace', () => {
  it('deletes the digit before an empty box', () => {
    expect(applyBackspace('48', 2)).toEqual({ value: '4', focus: 1 });
  });
  it('does nothing in a box that holds a digit or at the first box', () => {
    expect(applyBackspace('48', 1)).toBeNull();
    expect(applyBackspace('', 0)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('shows minutes and seconds', () => {
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(42)).toBe('0:42');
    expect(formatCountdown(0.2)).toBe('0:01');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

describe('triesLeftText', () => {
  const en = { one: '{n} try left', other: '{n} tries left' };
  const ar = {
    zero: 'لم تبقَ محاولات',
    one: 'بقيت محاولة واحدة',
    two: 'بقيت محاولتان',
    few: 'بقيت {n} محاولات',
    many: 'بقيت {n} محاولة',
    other: 'بقيت {n} محاولة',
  };
  it('uses the language plural forms', () => {
    expect(triesLeftText('en', 1, en)).toBe('1 try left');
    expect(triesLeftText('en', 3, en)).toBe('3 tries left');
    expect(triesLeftText('ar', 1, ar)).toBe('بقيت محاولة واحدة');
    expect(triesLeftText('ar', 2, ar)).toBe('بقيت محاولتان');
    expect(triesLeftText('ar', 3, ar)).toBe('بقيت 3 محاولات');
  });
});
