import { describe, expect, it } from 'vitest';
import { imageSize, imageTypeOf, stripImageMetadata } from './image-info';
import { pngChunk, pngImage } from './test-fixtures';

/**
 * Fixtures built in memory (no binary sample in the repository): small but structurally real PNG, JPEG and
 * WebP files that carry the metadata a phone or an editor writes (EXIF with a GPS marker, XMP, text, comments,
 * data after the end of the image).
 */

const utf8 = (text: string) => new TextEncoder().encode(text);
const cat = (...parts: (Uint8Array | readonly number[])[]) =>
  new Uint8Array(parts.flatMap((p) => [...p]));
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u16be = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const u24le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];

/** Contains the marker text? (EXIF / GPS / XMP left in the bytes.) */
const contains = (haystack: Uint8Array, needle: string) =>
  Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));

const GPS = 'GPSLatitude 24.7136 N';

// --- PNG: pngImage / pngChunk (test-fixtures) -------------------------------------------------------

const png = pngImage;

// --- JPEG --------------------------------------------------------------------------------------------

function segment(marker: number, data: Uint8Array | readonly number[]): Uint8Array {
  return cat([0xff, marker], u16be(data.length + 2), data);
}

const SOF0 = (width: number, height: number) =>
  segment(0xc0, [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0]);
const JFIF = segment(0xe0, cat(utf8('JFIF\0'), [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const ICC = segment(0xe2, cat(utf8('ICC_PROFILE\0'), [1, 1, 0x10, 0x20]));
const EXIF = segment(0xe1, cat(utf8('Exif\0\0'), utf8(GPS)));
const XMP = segment(0xe1, utf8(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${GPS}</x:xmpmeta>`));
const IPTC = segment(0xed, utf8('Photoshop 3.0\0 8BIM city=Riyadh'));
const COMMENT = segment(0xfe, utf8('taken by a phone'));
const MPF = segment(0xe2, utf8('MPF\0 second image'));
const DQT = segment(0xdb, [0, ...new Array<number>(64).fill(1)]);
const DHT = segment(0xc4, [0, ...new Array<number>(16).fill(0)]);
const SOS = segment(0xda, [1, 1, 0, 0, 0x3f, 0]);
/** Entropy-coded data with a stuffed FF 00 and a restart marker inside (not markers). */
const SCAN = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];
const EOI = [0xff, 0xd9];

function jpeg(width: number, height: number, metadata: readonly Uint8Array[] = []): Uint8Array {
  return cat([0xff, 0xd8], JFIF, ...metadata, ICC, DQT, SOF0(width, height), DHT, SOS, SCAN, EOI);
}

// --- WebP --------------------------------------------------------------------------------------------

function webpChunk(fourcc: string, data: Uint8Array | readonly number[]): Uint8Array {
  return cat(utf8(fourcc), u32le(data.length), data, data.length % 2 === 1 ? [0] : []);
}

function riff(...chunks: Uint8Array[]): Uint8Array {
  const body = cat(utf8('WEBP'), ...chunks);
  return cat(utf8('RIFF'), u32le(body.length), body);
}

const VP8 = (width: number, height: number) =>
  webpChunk('VP8 ', [
    0x30,
    0x01,
    0x00,
    0x9d,
    0x01,
    0x2a,
    ...[width & 0xff, width >> 8],
    ...[height & 0xff, height >> 8],
  ]);

function vp8x(width: number, height: number, flags: number): Uint8Array {
  return webpChunk('VP8X', [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]);
}

function vp8l(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  return webpChunk('VP8L', [0x2f, ...u32le(bits >>> 0), 0]);
}

describe('imageTypeOf', () => {
  it('knows PNG, JPEG and WebP by their signature only', () => {
    expect(imageTypeOf(png(1, 1))).toBe('image/png');
    expect(imageTypeOf(jpeg(1, 1))).toBe('image/jpeg');
    expect(imageTypeOf(riff(VP8(1, 1)))).toBe('image/webp');
    expect(imageTypeOf(utf8('GIF89a'))).toBeNull();
    expect(imageTypeOf(new Uint8Array(0))).toBeNull();
  });
});

describe('imageSize (header only)', () => {
  it('reads PNG IHDR', () => {
    expect(imageSize(png(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('reads JPEG SOF after metadata segments', () => {
    expect(imageSize(jpeg(1200, 300, [EXIF, XMP]))).toEqual({ width: 1200, height: 300 });
  });

  it('reads WebP VP8, VP8L and VP8X', () => {
    expect(imageSize(riff(VP8(320, 200)))).toEqual({ width: 320, height: 200 });
    expect(imageSize(riff(vp8l(4096, 17)))).toEqual({ width: 4096, height: 17 });
    expect(imageSize(riff(vp8x(9000, 512, 0), VP8(1, 1)))).toEqual({ width: 9000, height: 512 });
  });

  it('gives null for malformed, truncated or zero-sized images', () => {
    const good = png(10, 10);
    expect(imageSize(good.subarray(0, good.length - 3))).toBeNull(); // no IEND
    expect(imageSize(png(0, 10))).toBeNull();
    expect(imageSize(cat([0xff, 0xd8, 0xff, 0xe0, 0, 1]))).toBeNull();
    expect(imageSize(jpeg(10, 10).subarray(0, 40))).toBeNull();
    expect(imageSize(riff(webpChunk('VP8 ', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])))).toBeNull();
    const lying = riff(VP8(1, 1));
    lying.set(u32le(9999), 4); // RIFF size beyond the file
    expect(imageSize(lying)).toBeNull();
    expect(imageSize(utf8('<svg/>'))).toBeNull();
  });
});

describe('stripImageMetadata', () => {
  it('PNG: drops eXIf, tEXt, iTXt, zTXt, tIME and private chunks; keeps colour and pixels', () => {
    const clean = png(2, 2);
    const tagged = png(2, 2, [
      pngChunk('eXIf', cat(utf8('MM\0*'), utf8(GPS))),
      pngChunk('tEXt', utf8(`Comment\0${GPS}`)),
      pngChunk('iTXt', utf8(`XML:com.adobe.xmp\0\0\0\0\0${GPS}`)),
      pngChunk('zTXt', utf8('Author\0\0xx')),
      pngChunk('tIME', [7, 234, 10, 20, 12, 0, 0]),
      pngChunk('prVt', utf8('private data')),
    ]);
    const stripped = stripImageMetadata(cat(tagged, utf8('after the end')));
    expect(stripped).toEqual(clean);
    expect(stripped && contains(stripped, 'GPS')).toBe(false);
  });

  it('PNG: an image without metadata stays the same bytes', () => {
    const clean = png(3, 1, [pngChunk('pHYs', [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])]);
    expect(stripImageMetadata(clean)).toEqual(clean);
  });

  it('JPEG: drops APP1 (EXIF, XMP), APP13 (IPTC), COM, MPF and data after EOI; keeps JFIF, ICC, tables, scan', () => {
    const clean = jpeg(4, 4);
    const tagged = cat(jpeg(4, 4, [EXIF, XMP, IPTC, COMMENT, MPF]), utf8(`trailer ${GPS}`));
    const stripped = stripImageMetadata(tagged);
    expect(stripped).toEqual(clean);
    expect(stripped && contains(stripped, 'GPS')).toBe(false);
    expect(stripped && contains(stripped, 'ICC_PROFILE')).toBe(true);
    expect(stripped && imageSize(stripped)).toEqual({ width: 4, height: 4 });
  });

  it('JPEG: metadata between progressive scans is dropped too', () => {
    const progressive = cat(
      [0xff, 0xd8],
      JFIF,
      DQT,
      SOF0(8, 8),
      DHT,
      SOS,
      SCAN,
      COMMENT,
      DHT,
      SOS,
      SCAN,
      EOI,
    );
    const stripped = stripImageMetadata(progressive);
    expect(stripped).toEqual(
      cat([0xff, 0xd8], JFIF, DQT, SOF0(8, 8), DHT, SOS, SCAN, DHT, SOS, SCAN, EOI),
    );
  });

  it('JPEG: a truncated file (no end of image) is refused', () => {
    const cut = jpeg(4, 4);
    expect(stripImageMetadata(cut.subarray(0, cut.length - 2))).toBeNull();
  });

  it('WebP: drops EXIF and XMP, clears the VP8X flags and fixes the RIFF size', () => {
    const exifFlag = 0x08;
    const xmpFlag = 0x04;
    const iccFlag = 0x20;
    const tagged = riff(
      vp8x(16, 16, exifFlag | xmpFlag | iccFlag),
      webpChunk('ICCP', [1, 2, 3]),
      VP8(16, 16),
      webpChunk('EXIF', cat(utf8('MM\0*'), utf8(GPS))),
      webpChunk('XMP ', utf8(`<x:xmpmeta>${GPS}</x:xmpmeta>`)),
    );
    const stripped = stripImageMetadata(cat(tagged, utf8('after the RIFF')));
    const expected = riff(vp8x(16, 16, iccFlag), webpChunk('ICCP', [1, 2, 3]), VP8(16, 16));
    expect(stripped).toEqual(expected);
    expect(stripped && contains(stripped, 'GPS')).toBe(false);
    expect(stripped && imageSize(stripped)).toEqual({ width: 16, height: 16 });
  });

  it('WebP: a simple image stays the same bytes', () => {
    const simple = riff(VP8(5, 7));
    expect(stripImageMetadata(simple)).toEqual(simple);
  });

  it('refuses anything that is not a well-formed PNG, JPEG or WebP', () => {
    expect(stripImageMetadata(utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(stripImageMetadata(utf8('GIF89a'))).toBeNull();
    const badLength = png(1, 1);
    badLength.set(u32be(0xffff), 8); // IHDR length past the end
    expect(stripImageMetadata(badLength)).toBeNull();
  });
});
