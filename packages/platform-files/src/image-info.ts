/**
 * Image headers without an image library (WP-ADM-02 security review M2 / L8): the size in pixels of a PNG,
 * JPEG or WebP read from its header (PNG IHDR, JPEG SOFn, WebP VP8 / VP8L / VP8X), and a copy WITHOUT its
 * metadata — what a camera or an editor writes about a picture (EXIF with the GPS position and the device,
 * XMP, IPTC, comments, text chunks, data hidden after the end of the image). The pixels and the colour
 * profile (ICC) are kept byte for byte: nothing is decoded or re-encoded.
 *
 * Allow-lists, not deny-lists: only the parts an image needs to show correctly are kept (PNG: the critical
 * chunks and the colour / transparency / animation chunks; JPEG: the coding segments, JFIF APP0, ICC APP2 and
 * Adobe APP14; WebP: the image, alpha, animation and ICC chunks). Pure TypeScript on Uint8Array (no Node or
 * DOM APIs), so the worker strips before a copy goes public and the browser checks the size before an upload.
 * A malformed or truncated file gives null — the caller refuses it.
 */

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const at = (b: Uint8Array, i: number) => b[i] ?? 0;
const u16be = (b: Uint8Array, i: number) => (at(b, i) << 8) | at(b, i + 1);
const u16le = (b: Uint8Array, i: number) => at(b, i) | (at(b, i + 1) << 8);
const u24le = (b: Uint8Array, i: number) => u16le(b, i) + at(b, i + 2) * 0x10000;
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 0x10000 + u16be(b, i + 2);
const u32le = (b: Uint8Array, i: number) => u16le(b, i) + u16le(b, i + 2) * 0x10000;
const ascii = (b: Uint8Array, i: number, n: number) => {
  let text = '';
  for (let k = 0; k < n; k += 1) text += String.fromCharCode(at(b, i + k));
  return text;
};

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The type by signature (PNG, JPEG, WebP), else null. */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

interface Part {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------------------------------
// PNG: 8-byte signature, then chunks [length:4 BE][type:4][data][crc:4], IHDR first, IEND last.
// ---------------------------------------------------------------------------------------------------

/**
 * Kept: the critical chunks, transparency, colour (gamma, chromaticities, sRGB, ICC, CICP, HDR), significant
 * bits, background, pixel size, and APNG animation. Dropped: everything else (eXIf, tEXt, iTXt, zTXt, tIME,
 * private chunks).
 */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'cICP',
  'mDCv',
  'cLLi',
  'sBIT',
  'bKGD',
  'pHYs',
  'acTL',
  'fcTL',
  'fdAT',
]);

interface PngChunk extends Part {
  readonly type: string;
}

function pngChunks(bytes: Uint8Array): PngChunk[] | null {
  if (imageTypeOf(bytes) !== 'image/png') return null;
  const chunks: PngChunk[] = [];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const end = i + 12 + u32be(bytes, i);
    if (end > bytes.length) return null;
    const type = ascii(bytes, i + 4, 4);
    chunks.push({ type, start: i, end });
    if (type === 'IEND') break;
    i = end;
  }
  const ihdr = chunks[0];
  if (ihdr?.type !== 'IHDR' || ihdr.end - ihdr.start !== 25 || chunks.at(-1)?.type !== 'IEND') {
    return null;
  }
  return chunks;
}

// ---------------------------------------------------------------------------------------------------
// JPEG: SOI, then segments FF xx [length:2 BE, incl. itself]; after each SOS header the entropy-coded data
// (FF only as FF 00, restart markers FF D0–D7 or fill bytes) up to the next marker; EOI ends the image.
// ---------------------------------------------------------------------------------------------------

const APP0 = 0xe0;
const APP2 = 0xe2;
const APP14 = 0xee;
const SOS = 0xda;
const EOI = 0xd9;
const isApp = (m: number) => m >= 0xe0 && m <= 0xef;
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** Kept APPn: JFIF / JFXX (APP0), the ICC profile (APP2 "ICC_PROFILE"), Adobe's colour transform (APP14). */
function keepJpegSegment(bytes: Uint8Array, marker: number, start: number): boolean {
  if (marker === 0xfe) return false; // COM: a comment
  if (!isApp(marker)) return true;
  if (marker === APP0 || marker === APP14) return true;
  return marker === APP2 && ascii(bytes, start + 4, 12) === 'ICC_PROFILE\0';
}

interface JpegLayout {
  /** In order: marker segments (with their marker) and entropy-coded data (marker null). */
  readonly parts: readonly (Part & { readonly marker: number | null })[];
}

function jpegLayout(bytes: Uint8Array): JpegLayout | null {
  if (imageTypeOf(bytes) !== 'image/jpeg') return null;
  const parts: (Part & { marker: number | null })[] = [{ start: 0, end: 2, marker: 0xd8 }];
  let i = 2;
  for (;;) {
    if (i + 2 > bytes.length || bytes[i] !== 0xff) return null;
    const marker = at(bytes, i + 1);
    if (marker === 0xff) {
      i += 1; // a fill byte before a marker
      continue;
    }
    if (marker === EOI) {
      parts.push({ start: i, end: i + 2, marker });
      return { parts }; // anything after the end of the image is dropped
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) return null; // out of place
    const length = u16be(bytes, i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    parts.push({ start: i, end, marker });
    i = end;
    if (marker !== SOS) continue;
    // Entropy-coded data up to the next marker that is not a stuffed byte or a restart marker.
    let j = i;
    for (;;) {
      if (j + 1 >= bytes.length) return null; // truncated: no EOI
      if (bytes[j] === 0xff) {
        const next = at(bytes, j + 1);
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          j += 2;
          continue;
        }
        if (next === 0xff) {
          j += 1;
          continue;
        }
        break;
      }
      j += 1;
    }
    parts.push({ start: i, end: j, marker: null });
    i = j;
  }
}

// ---------------------------------------------------------------------------------------------------
// WebP: "RIFF" [size:4 LE] "WEBP", then chunks [fourcc:4][size:4 LE][data, padded to even] up to the size.
// ---------------------------------------------------------------------------------------------------

/** Kept: the image (lossy, lossless, extended header), alpha, animation and the ICC profile. */
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
/** VP8X flags: bit 2 XMP, bit 3 EXIF (cleared: those chunks are dropped). */
const VP8X_METADATA_FLAGS = 0x04 | 0x08;

interface WebpChunk extends Part {
  readonly fourcc: string;
  readonly dataStart: number;
  readonly size: number;
}

function webpChunks(bytes: Uint8Array): WebpChunk[] | null {
  if (imageTypeOf(bytes) !== 'image/webp') return null;
  const riffEnd = 8 + u32le(bytes, 4);
  if (riffEnd > bytes.length || riffEnd < 20) return null;
  const chunks: WebpChunk[] = [];
  let i = 12;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) return null;
    const size = u32le(bytes, i + 4);
    const dataEnd = i + 8 + size;
    if (dataEnd > riffEnd) return null;
    const end = Math.min(dataEnd + (size % 2), riffEnd);
    chunks.push({ fourcc: ascii(bytes, i, 4), start: i, dataStart: i + 8, size, end });
    i = end;
  }
  return chunks.length > 0 ? chunks : null;
}

function positive(size: ImageSize): ImageSize | null {
  return size.width > 0 && size.height > 0 ? size : null;
}

/** The size in pixels from the header, or null when the file is not a well-formed PNG, JPEG or WebP. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const type = imageTypeOf(bytes);
  if (type === 'image/png') {
    const ihdr = pngChunks(bytes)?.[0];
    if (!ihdr) return null;
    return positive({ width: u32be(bytes, ihdr.start + 8), height: u32be(bytes, ihdr.start + 12) });
  }
  if (type === 'image/jpeg') {
    const sof = jpegLayout(bytes)?.parts.find((p) => p.marker !== null && isSof(p.marker));
    if (!sof || sof.end - sof.start < 10) return null;
    return positive({ width: u16be(bytes, sof.start + 7), height: u16be(bytes, sof.start + 5) });
  }
  if (type === 'image/webp') {
    const first = webpChunks(bytes)?.[0];
    if (!first) return null;
    const d = first.dataStart;
    if (first.fourcc === 'VP8X' && first.size >= 10) {
      return positive({ width: u24le(bytes, d + 4) + 1, height: u24le(bytes, d + 7) + 1 });
    }
    if (first.fourcc === 'VP8 ' && first.size >= 10) {
      if (bytes[d + 3] !== 0x9d || bytes[d + 4] !== 0x01 || bytes[d + 5] !== 0x2a) return null;
      return positive({
        width: u16le(bytes, d + 6) & 0x3fff,
        height: u16le(bytes, d + 8) & 0x3fff,
      });
    }
    if (first.fourcc === 'VP8L' && first.size >= 5) {
      if (bytes[d] !== 0x2f) return null;
      const bits = u32le(bytes, d + 1);
      return positive({
        width: (bits & 0x3fff) + 1,
        height: (Math.floor(bits / 0x4000) & 0x3fff) + 1,
      });
    }
    return null;
  }
  return null;
}

/**
 * The same image without its metadata (see the module comment), or null when the file is malformed. The
 * result of an image without metadata is byte-for-byte the input (minus anything after its end).
 */
export function stripImageMetadata(bytes: Uint8Array): Uint8Array | null {
  const type = imageTypeOf(bytes);
  if (type === 'image/png') {
    const chunks = pngChunks(bytes);
    if (!chunks) return null;
    return concat([
      bytes.subarray(0, 8),
      ...chunks.filter((c) => PNG_KEEP.has(c.type)).map((c) => bytes.subarray(c.start, c.end)),
    ]);
  }
  if (type === 'image/jpeg') {
    const layout = jpegLayout(bytes);
    if (!layout) return null;
    return concat(
      layout.parts
        .filter((p) => p.marker === null || keepJpegSegment(bytes, p.marker, p.start))
        .map((p) => bytes.subarray(p.start, p.end)),
    );
  }
  if (type === 'image/webp') {
    const chunks = webpChunks(bytes);
    if (!chunks) return null;
    const kept = chunks
      .filter((c) => WEBP_KEEP.has(c.fourcc))
      .map((c) => {
        const copy = bytes.slice(c.start, c.end);
        if (c.fourcc === 'VP8X') copy[8] = at(copy, 8) & ~VP8X_METADATA_FLAGS;
        return copy;
      });
    const body = concat(kept);
    const header = bytes.slice(0, 12);
    const riffSize = body.length + 4;
    header[4] = riffSize & 0xff;
    header[5] = (riffSize >>> 8) & 0xff;
    header[6] = (riffSize >>> 16) & 0xff;
    header[7] = (riffSize >>> 24) & 0xff;
    return concat([header, body]);
  }
  return null;
}
