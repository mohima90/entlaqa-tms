import { describe, expect, it } from 'vitest';
import { FILE_PURPOSES, XLSX, isFilePurpose, normalizeDeclaredType, purposeOf } from './purposes';

describe('file purposes', () => {
  it('knows the platform purposes and nothing inherited', () => {
    expect(isFilePurpose('platform.user_import')).toBe(true);
    expect(isFilePurpose('platform.profile_photo')).toBe(true);
    expect(isFilePurpose('toString')).toBe(false);
    expect(isFilePurpose('tms.unknown')).toBe(false);
    expect(purposeOf('platform.user_import_report').uploadBy).toBe('worker');
  });

  it('matches ADR 0006 §1 (buckets, limits, no SVG or GIF for images)', () => {
    expect(FILE_PURPOSES['platform.user_import']).toMatchObject({
      bucket: 'imports',
      maxBytes: 20 * 1024 * 1024,
      types: ['text/csv', XLSX],
    });
    expect(FILE_PURPOSES['platform.profile_photo'].types).not.toContain('image/svg+xml');
    expect(FILE_PURPOSES['platform.profile_photo'].types).not.toContain('image/gif');
  });
});

describe('normalizeDeclaredType', () => {
  it('takes the type from the extension when the purpose accepts it', () => {
    expect(
      normalizeDeclaredType('platform.user_import', 'staff.CSV', 'application/octet-stream'),
    ).toBe('text/csv');
    expect(normalizeDeclaredType('platform.user_import', 'staff.xlsx', '')).toBe(XLSX);
    expect(normalizeDeclaredType('platform.profile_photo', 'me.JPG', null)).toBe('image/jpeg');
  });

  it('refuses a known extension the purpose does not accept, whatever the browser says', () => {
    expect(normalizeDeclaredType('platform.user_import', 'cv.pdf', 'text/csv')).toBeNull();
    expect(normalizeDeclaredType('platform.profile_photo', 'staff.csv', 'image/png')).toBeNull();
  });

  it("otherwise uses the browser's type, aliases resolved", () => {
    expect(
      normalizeDeclaredType('platform.user_import', 'export', 'application/vnd.ms-excel'),
    ).toBe('text/csv');
    expect(normalizeDeclaredType('platform.profile_photo', 'photo', ' IMAGE/JPG ')).toBe(
      'image/jpeg',
    );
    expect(normalizeDeclaredType('platform.user_import', '.csv', 'text/csv')).toBe('text/csv');
    expect(
      normalizeDeclaredType('platform.user_import', 'run.exe', 'application/x-msdownload'),
    ).toBeNull();
    expect(normalizeDeclaredType('platform.user_import', 'data', undefined)).toBeNull();
  });
});
