import { crc32 } from 'node:zlib';

/**
 * Test-only builders (imported by *.test.ts files only): minimal real file formats, built in memory so no
 * binary sample sits in the repository.
 */

/** A ZIP archive with stored (uncompressed) entries, as OOXML files are laid out. */
export function zip(entries: Record<string, string>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, centralBytes, end]));
}

const contentTypes = (main: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${main}"/></Types>`;

/** An XLSX workbook (or, with `macros`, an XLSM). */
export function workbook(macros = false): Uint8Array {
  return zip({
    '[Content_Types].xml': contentTypes(
      macros
        ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    ),
    'xl/workbook.xml': '<workbook/>',
  });
}

export const bytes = (...values: number[]) => new Uint8Array(values);

/** Bytes from a hexadecimal description (spaces ignored). */
const hex = (value: string) => new Uint8Array(Buffer.from(value.replaceAll(' ', ''), 'hex'));

/** PNG signature and the start of its IHDR chunk (1 x 1 pixel). */
export const PNG = hex('89504e47 0d0a1a0a 0000000d 49484452 00000001 00000001 08020000 00');

/** OLE compound file (legacy .xls, password-protected Office files): its signature, then zeros. */
export const CFB = new Uint8Array(Buffer.concat([hex('d0cf11e0 a1b11ae1'), Buffer.alloc(504)]));

/** A Windows executable's start. */
export const EXE = new Uint8Array(
  Buffer.concat([
    Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]),
    Buffer.alloc(240),
  ]),
);

export async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
