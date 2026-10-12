import { extensionForType, typeOfExtension } from './purposes';

/**
 * Original file names (ADR 0006 §2): kept only for display and the download's Content-Disposition (RFC
 * 6266, `filename*` in UTF-8, so Arabic names work) — never part of a Storage key. Sanitized here, checked
 * again by the database (files_name_check): Unicode NFC; no control characters (C0, DEL, C1), no
 * bidirectional controls or byte-order mark (a right-to-left override can disguise `photo<U+202E>gpj.exe` as
 * `photoexe.jpg`), no path separators or characters Windows refuses in names; no leading dots or spaces;
 * at most MAX_NAME_LENGTH characters, extension kept.
 */
export const MAX_NAME_LENGTH = 200;
const FALLBACK = 'file';

/** Code points removed: invisible controls that could change how the name reads. */
function isRemoved(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x061c ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

/** Characters replaced by `_`: path separators and what Windows does not allow in names. */
const REPLACED = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);

function trimEdges(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === '.' || value[start] === ' ')) start += 1;
  while (end > start && (value[end - 1] === ' ' || value[end - 1] === '.')) end -= 1;
  return value.slice(start, end);
}

export function sanitizeFileName(raw: string): string {
  let cleaned = '';
  for (const char of raw.normalize('NFC')) {
    const cp = char.codePointAt(0) ?? 0;
    if (isRemoved(cp)) continue;
    cleaned += REPLACED.has(char) ? '_' : char;
  }
  cleaned = trimEdges(cleaned);
  const chars = Array.from(cleaned);
  if (chars.length > MAX_NAME_LENGTH) {
    const dot = cleaned.lastIndexOf('.');
    const extension = dot > 0 ? Array.from(cleaned.slice(dot)) : [];
    const keep = extension.length > 0 && extension.length <= 10 ? extension : [];
    cleaned = trimEdges(chars.slice(0, MAX_NAME_LENGTH - keep.length).join('')) + keep.join('');
  }
  return cleaned === '' ? FALLBACK : cleaned;
}

/**
 * The name a download is saved under (Content-Disposition): the sanitized original name, but with the
 * extension of the type the scan DETECTED by content — never an extension the uploader chose (`.hta`,
 * `.js`, `.bat` would make the saved file run as a program). The uploader's own extension is kept only
 * when it names that same type (`photo.JPEG` for a JPEG); without a known extension for the type the
 * name gets none.
 */
export function downloadName(name: string, detectedType: string | null): string {
  const clean = sanitizeFileName(name);
  if (detectedType !== null && typeOfExtension(clean) === detectedType) return clean;
  const dot = clean.lastIndexOf('.');
  const base = dot > 0 ? clean.slice(0, dot) : clean;
  const extension = detectedType === null ? null : extensionForType(detectedType);
  return extension === null ? base : `${base}${extension}`;
}
