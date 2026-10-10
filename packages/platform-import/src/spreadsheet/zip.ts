import { Inflate } from 'fflate';
import { SpreadsheetError } from './errors';

/**
 * A minimal ZIP reader for XLSX files (T-M2-12): the central directory of a file already in memory (at
 * most 20 MB, the import's limit), and entries inflated as a stream with a hard limit on what they may
 * inflate to — so a ZIP bomb stops at the limit instead of filling the memory. Only what XLSX writers
 * use: one disk, no ZIP64, stored or deflated entries, no encryption (an encrypted entry is a protected
 * file).
 */
export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly localOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRIES = 10_000;
/** Compressed bytes pushed at a time: what one push may inflate to stays bounded (≈ 1:1032). */
const INPUT_SLICE = 16 * 1024;

const unreadable = () => new SpreadsheetError('FILE_UNREADABLE');

function u16(bytes: Uint8Array, at: number): number {
  if (at + 2 > bytes.length) throw unreadable();
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  if (at + 4 > bytes.length) throw unreadable();
  return (
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0
  );
}

/** Does the file start like a ZIP archive (local file header)? */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && u32(bytes, 0) === LOCAL_SIGNATURE;
}

export class ZipArchive {
  private readonly entries = new Map<string, ZipEntry>();

  constructor(private readonly bytes: Uint8Array) {
    const end = this.findEndOfCentralDirectory();
    const disk = u16(bytes, end + 4);
    const directoryDisk = u16(bytes, end + 6);
    const count = u16(bytes, end + 10);
    const size = u32(bytes, end + 12);
    const offset = u32(bytes, end + 16);
    // Multi-disk and ZIP64 archives are not XLSX files we read.
    if (disk !== 0 || directoryDisk !== 0 || count === 0xffff || offset === 0xffffffff) {
      throw unreadable();
    }
    if (count > MAX_ENTRIES || offset + size > end) throw unreadable();
    const names = new TextDecoder('utf-8');
    let at = offset;
    for (let i = 0; i < count; i += 1) {
      if (u32(bytes, at) !== CENTRAL_SIGNATURE) throw unreadable();
      const flags = u16(bytes, at + 8);
      const method = u16(bytes, at + 10);
      const compressedSize = u32(bytes, at + 20);
      const nameLength = u16(bytes, at + 28);
      const extraLength = u16(bytes, at + 30);
      const commentLength = u16(bytes, at + 32);
      const localOffset = u32(bytes, at + 42);
      if (at + 46 + nameLength > bytes.length) throw unreadable();
      const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
      // Bit 0: encrypted (a password-protected archive).
      if ((flags & 1) !== 0) throw new SpreadsheetError('FILE_PROTECTED');
      if (compressedSize === 0xffffffff || localOffset === 0xffffffff) throw unreadable();
      this.entries.set(normalizeName(name), { name, method, compressedSize, localOffset });
      at += 46 + nameLength + extraLength + commentLength;
    }
  }

  private findEndOfCentralDirectory(): number {
    const { bytes } = this;
    const last = bytes.length - 22;
    const first = Math.max(0, last - 0xffff);
    for (let at = last; at >= first; at -= 1) {
      if (u32(bytes, at) === EOCD_SIGNATURE) return at;
    }
    throw unreadable();
  }

  /** Entry names as stored (OPC part names are compared without case and leading slash). */
  names(): string[] {
    return [...this.entries.values()].map((entry) => entry.name);
  }

  has(name: string): boolean {
    return this.entries.has(normalizeName(name));
  }

  /**
   * The entry's bytes, inflated piece by piece. Throws FILE_UNREADABLE when it would inflate to more than
   * `maxBytes`, is truncated or uses a compression we do not read.
   */
  *chunks(name: string, maxBytes: number): Generator<Uint8Array> {
    const entry = this.entries.get(normalizeName(name));
    if (!entry) throw unreadable();
    const { bytes } = this;
    if (u32(bytes, entry.localOffset) !== LOCAL_SIGNATURE) throw unreadable();
    const start =
      entry.localOffset +
      30 +
      u16(bytes, entry.localOffset + 26) +
      u16(bytes, entry.localOffset + 28);
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw unreadable();
    if (entry.method === 0) {
      if (entry.compressedSize > maxBytes) throw unreadable();
      for (let at = start; at < end; at += INPUT_SLICE) {
        yield bytes.subarray(at, Math.min(end, at + INPUT_SLICE));
      }
      return;
    }
    if (entry.method !== 8) throw unreadable();
    const state = { produced: 0, finished: false };
    const out: Uint8Array[] = [];
    const inflate = new Inflate((data, final) => {
      state.produced += data.length;
      if (state.produced > maxBytes) throw unreadable();
      out.push(data);
      if (final) state.finished = true;
    });
    for (let at = start; at < end; at += INPUT_SLICE) {
      const last = at + INPUT_SLICE >= end;
      try {
        inflate.push(bytes.subarray(at, Math.min(end, at + INPUT_SLICE)), last);
      } catch (error) {
        if (error instanceof SpreadsheetError) throw error;
        throw unreadable();
      }
      yield* out.splice(0);
    }
    if (entry.compressedSize === 0 || !state.finished) throw unreadable();
  }

  /** A small entry as UTF-8 text (e.g. the workbook, its relationships, the styles). */
  text(name: string, maxBytes: number): string {
    const decoder = new TextDecoder('utf-8');
    let text = '';
    for (const chunk of this.chunks(name, maxBytes))
      text += decoder.decode(chunk, { stream: true });
    return text + decoder.decode();
  }
}

/** OPC part names: no leading slash, compared without letter case. */
export function normalizeName(name: string): string {
  return (name.startsWith('/') ? name.slice(1) : name).toLowerCase();
}
