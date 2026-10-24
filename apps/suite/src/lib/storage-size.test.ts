import { describe, expect, it } from 'vitest';
import { gigabytes } from './storage-size';

describe('gigabytes (WP-ADM-06)', () => {
  it('counts 1024³ bytes per GB, one decimal below 10 GB, Latin digits', () => {
    expect(gigabytes(0, 'en')).toBe('0');
    expect(gigabytes(3.2 * 1024 ** 3, 'en')).toBe('3.2');
    expect(gigabytes(142 * 1024 ** 3 + 5, 'en')).toBe('142');
    expect(gigabytes(1.5 * 1024 ** 3, 'ar')).toBe('1.5');
  });
});
