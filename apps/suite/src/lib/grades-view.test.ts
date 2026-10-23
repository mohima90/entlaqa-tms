import { describe, expect, it } from 'vitest';
import { checkGradeCode } from './grades-view';

describe('checkGradeCode (WP-ADM-04; PO 23 Oct 2026: letters, digits and punctuation)', () => {
  it('accepts a number, a letter and a number, and punctuation', () => {
    for (const code of ['7', 'G7', '#7', 'G-7', 'm3', '12.5', 'ب٢']) {
      expect(checkGradeCode(code), code).toHaveProperty('code');
    }
  });

  it('trims, and writes digits in Latin whatever the keyboard', () => {
    expect(checkGradeCode('  G7 ')).toEqual({ code: 'G7' });
    expect(checkGradeCode('٧')).toEqual({ code: '7' });
    expect(checkGradeCode('G۷')).toEqual({ code: 'G7' });
  });

  it('asks for a code when there is none', () => {
    expect(checkGradeCode('')).toEqual({ problem: 'required' });
    expect(checkGradeCode('   ')).toEqual({ problem: 'required' });
  });

  it('refuses spaces inside, punctuation only, invisible marks and more than 12 characters', () => {
    for (const bad of [
      'G 7',
      '---',
      '#',
      'ABCDEFGHIJKLM',
      `G${String.fromCharCode(0x202e)}7`,
      `G${String.fromCharCode(0x200b)}7`,
      'G\t7',
    ]) {
      expect(checkGradeCode(bad), JSON.stringify(bad)).toEqual({ problem: 'format' });
    }
    expect(checkGradeCode('ABCDEFGHIJKL')).toEqual({ code: 'ABCDEFGHIJKL' });
  });
});
