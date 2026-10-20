import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_EXTENSIONS,
  EXTENSION_BY_TYPE,
  FILE_PURPOSES,
  XLSX,
  declaredTypeFor,
  extensionForType,
  extensionOf,
  isFilePurpose,
  purposeOf,
  typeOfExtension,
} from './purposes';

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

  it('branding images: PNG/JPEG/WebP only, Kawadir limits (WP-ADM-02, BR-BRD-b)', () => {
    const limits = {
      'platform.brand_logo': 2 * 1024 * 1024,
      'platform.brand_favicon': 500 * 1024,
      'platform.brand_sign_in_image': 5 * 1024 * 1024,
    } as const;
    for (const [purpose, maxBytes] of Object.entries(limits)) {
      expect(isFilePurpose(purpose)).toBe(true);
      expect(FILE_PURPOSES[purpose as keyof typeof limits]).toMatchObject({
        bucket: 'images',
        maxBytes,
        types: ['image/png', 'image/jpeg', 'image/webp'],
        uploadBy: 'user',
      });
      expect(declaredTypeFor(purpose as keyof typeof limits, 'logo.svg')).toBeNull();
      expect(declaredTypeFor(purpose as keyof typeof limits, 'logo.gif')).toBeNull();
      expect(declaredTypeFor(purpose as keyof typeof limits, 'logo.ico')).toBeNull();
      expect(declaredTypeFor(purpose as keyof typeof limits, 'logo.html')).toBeNull();
      expect(declaredTypeFor(purpose as keyof typeof limits, 'logo.WEBP')).toBe('image/webp');
      expect(declaredTypeFor(purpose as keyof typeof limits, 'شعار.png')).toBe('image/png');
    }
  });

  it('download links live at most 5 minutes (ADR 0006 §4)', () => {
    for (const purpose of Object.values(FILE_PURPOSES)) {
      expect(purpose.downloadTtlSeconds).toBeLessThanOrEqual(300);
    }
  });

  it('every type a purpose may hold has a download extension that names it again', () => {
    for (const purpose of Object.values(FILE_PURPOSES)) {
      for (const type of purpose.types) {
        const extension = extensionForType(type);
        expect(extension, type).not.toBeNull();
        expect(typeOfExtension(`file${extension ?? ''}`)).toBe(type);
      }
    }
    expect(Object.keys(EXTENSION_BY_TYPE)).not.toContain('text/html');
    expect(extensionForType('constructor')).toBeNull();
    // What a download name can end in: every canonical extension, and other spellings of those types.
    expect(DOWNLOAD_EXTENSIONS).toEqual([
      '.csv',
      '.jpeg',
      '.jpg',
      '.pdf',
      '.png',
      '.webp',
      '.xlsx',
    ]);
    for (const extension of Object.values(EXTENSION_BY_TYPE)) {
      expect(DOWNLOAD_EXTENSIONS).toContain(extension);
    }
  });
});

describe('declaredTypeFor', () => {
  it('takes the type from the extension when the purpose accepts it', () => {
    expect(declaredTypeFor('platform.user_import', 'staff.CSV')).toBe('text/csv');
    expect(declaredTypeFor('platform.user_import', 'staff.xlsx')).toBe(XLSX);
    expect(declaredTypeFor('platform.profile_photo', 'me.JPG')).toBe('image/jpeg');
    expect(declaredTypeFor('platform.profile_photo', 'me.jpeg')).toBe('image/jpeg');
  });

  it('refuses a known extension the purpose does not accept', () => {
    expect(declaredTypeFor('platform.user_import', 'cv.pdf')).toBeNull();
    expect(declaredTypeFor('platform.profile_photo', 'staff.csv')).toBeNull();
  });

  it('refuses a name without an extension, or with one we do not know (executables, scripts)', () => {
    for (const name of [
      'export',
      'staff.csv.hta',
      'run.exe',
      'setup.js',
      'tool.bat',
      'page.html',
      'x.svg',
      '.csv',
      'a.constructor',
    ]) {
      expect(declaredTypeFor('platform.user_import', name), name).toBeNull();
    }
    expect(extensionOf('archive.tar.GZ')).toBe('.gz');
    expect(extensionOf('noext')).toBe('');
  });
});
