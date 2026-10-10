import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { SpreadsheetError } from './errors';

/**
 * Streaming XML for the parts of an XLSX file (saxes: no DTD, no entity expansion beyond the five XML
 * entities, nothing fetched). A document type declaration is refused outright. The text between two tags
 * — the only thing the parser buffers — is limited, so a crafted part cannot make it hold more than that.
 */
export const MAX_XML_GAP = 1_000_000;

export interface XmlHandlers {
  open(name: string, attributes: Readonly<Record<string, string>>): void;
  close?(name: string): void;
  text?(text: string): void;
}

/** The element name without its namespace prefix (`x:row` → `row`). */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** An attribute by local name (`r:id` → `id` when asked for `id` with `prefixed`). */
export function attribute(
  attributes: Readonly<Record<string, string>>,
  name: string,
  prefixed = false,
): string | undefined {
  for (const [key, value] of Object.entries(attributes)) {
    const colon = key.indexOf(':');
    if (prefixed ? colon !== -1 && key.slice(colon + 1) === name : key === name) return value;
  }
  return undefined;
}

const unreadable = () => new SpreadsheetError('FILE_UNREADABLE');

/** Checks the longest run without `<` or `>` (what the parser would have to buffer). */
class GapGuard {
  private sinceLt = 0;
  private sinceGt = 0;

  check(text: string): void {
    this.sinceLt = longestRun(text, '<', this.sinceLt);
    this.sinceGt = longestRun(text, '>', this.sinceGt);
  }
}

function longestRun(text: string, char: string, carried: number): number {
  let run = carried;
  let at = 0;
  for (;;) {
    const next = text.indexOf(char, at);
    if (next === -1) {
      run += text.length - at;
      if (run > MAX_XML_GAP) throw unreadable();
      return run;
    }
    run += next - at;
    if (run > MAX_XML_GAP) throw unreadable();
    run = 0;
    at = next + 1;
  }
}

/** A push parser: `write` decoded text, `end` once; handlers run synchronously. */
export class XmlStream {
  private readonly parser = new SaxesParser({ xmlns: false, position: false });
  private readonly guard = new GapGuard();
  private readonly decoder = new TextDecoder('utf-8');
  private failure: unknown = null;

  constructor(handlers: XmlHandlers) {
    const parser = this.parser;
    parser.on('doctype', () => {
      this.failure = unreadable();
    });
    parser.on('opentag', (tag: SaxesTagPlain) => {
      if (this.failure === null) {
        try {
          handlers.open(localName(tag.name), tag.attributes);
        } catch (error) {
          this.failure = error;
        }
      }
    });
    parser.on('closetag', (tag: SaxesTagPlain) => {
      if (this.failure === null) {
        try {
          handlers.close?.(localName(tag.name));
        } catch (error) {
          this.failure = error;
        }
      }
    });
    parser.on('text', (text: string) => {
      if (this.failure === null) {
        try {
          handlers.text?.(text);
        } catch (error) {
          this.failure = error;
        }
      }
    });
    parser.on('cdata', (text: string) => {
      if (this.failure === null) {
        try {
          handlers.text?.(text);
        } catch (error) {
          this.failure = error;
        }
      }
    });
    parser.on('error', () => {
      if (this.failure === null) this.failure = unreadable();
    });
  }

  write(bytes: Uint8Array): void {
    this.writeText(this.decoder.decode(bytes, { stream: true }));
  }

  end(): void {
    this.writeText(this.decoder.decode());
    try {
      this.parser.close();
    } catch {
      if (this.failure === null) this.failure = unreadable();
    }
    this.raise();
  }

  private writeText(text: string): void {
    if (text === '') return;
    this.guard.check(text);
    try {
      this.parser.write(text);
    } catch {
      if (this.failure === null) this.failure = unreadable();
    }
    this.raise();
  }

  private raise(): void {
    if (this.failure === null) return;
    throw this.failure instanceof Error ? this.failure : unreadable();
  }
}

/** A whole small part through the handlers. */
export function parseXml(chunks: Iterable<Uint8Array>, handlers: XmlHandlers): void {
  const stream = new XmlStream(handlers);
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
}

/** Lets the event loop run (timers, I/O, the lease's renewal) between pieces of long parsing work. */
export function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Inflated bytes parsed between two yields to the event loop (security review H1). */
export const YIELD_BYTES = 1024 * 1024;

/** A part through the handlers, letting the event loop run every YIELD_BYTES. */
export async function parseXmlAsync(
  chunks: Iterable<Uint8Array>,
  handlers: XmlHandlers,
): Promise<void> {
  const stream = new XmlStream(handlers);
  let since = 0;
  for (const chunk of chunks) {
    stream.write(chunk);
    since += chunk.length;
    if (since >= YIELD_BYTES) {
      since = 0;
      await yieldToLoop();
    }
  }
  stream.end();
}
