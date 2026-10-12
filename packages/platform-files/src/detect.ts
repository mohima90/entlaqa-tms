import { fileTypeFromBuffer } from 'file-type';

/**
 * Content-type detection (ADR 0006 §3.4; T-M2-18): the declared type and the name are never trusted. Binary
 * formats by their signature (`file-type`: PNG, JPEG, WebP, PDF, ZIP containers incl. telling XLSX from
 * XLSM or DOCX, OLE/CFB as used by .xls and password-protected Office files, executables, …); text by
 * strict sniffing: UTF-8 (with or without BOM) without control characters other than tab and line breaks;
 * CSV when the first line holds a comma, semicolon or tab (the import screens' rule: UTF-8 only, comma or
 * semicolon detected).
 */

/** Bytes looked at: the start of the file (OOXML: its `[Content_Types].xml` entry comes first). */
export const DETECTION_HEAD_BYTES = 1024 * 1024;

const UTF8_BOM = [0xef, 0xbb, 0xbf];

function hasBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && UTF8_BOM.every((b, i) => bytes[i] === b);
}

/**
 * `text/csv`, `text/plain` or null (not UTF-8 text). `complete`: the bytes are the whole file (a head
 * cut inside a multi-byte character is not an encoding error).
 */
export function sniffText(bytes: Uint8Array, complete: boolean): 'text/csv' | 'text/plain' | null {
  const body = hasBom(bytes) ? bytes.subarray(3) : bytes;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body, {
      stream: !complete,
    });
  } catch {
    return null;
  }
  if (text.length === 0) return null;
  let firstLine = '';
  let inFirstLine = true;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if ((cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || cp === 0x7f) return null;
    if (inFirstLine) {
      if (cp === 0x0a || cp === 0x0d) {
        if (firstLine.trim() !== '') inFirstLine = false;
      } else {
        firstLine += char;
      }
    }
  }
  return firstLine.includes(',') || firstLine.includes(';') || firstLine.includes('\t')
    ? 'text/csv'
    : 'text/plain';
}

/**
 * The type of a file from its first bytes (`head`, at most DETECTION_HEAD_BYTES); `complete` when the head
 * is the whole file. Null: not recognized (refused for every purpose).
 */
export async function detectType(head: Uint8Array, complete: boolean): Promise<string | null> {
  if (head.length === 0) return null;
  const binary = await fileTypeFromBuffer(head);
  if (binary) return binary.mime.toLowerCase();
  return sniffText(head, complete);
}
