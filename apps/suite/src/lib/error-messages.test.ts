import { PlatformErrors } from '@jadarat/platform-core';
import { getMessages } from '@jadarat/platform-i18n';
import { describe, expect, it } from 'vitest';

function lookup(messages: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    );
}

describe('platform error messages (ADR 0011 §3)', () => {
  it('every platform error messageKey exists in Arabic and English', () => {
    for (const locale of ['ar', 'en'] as const) {
      for (const def of Object.values(PlatformErrors)) {
        const message = lookup(getMessages(locale), def.messageKey);
        expect(typeof message, `${locale}: ${def.messageKey}`).toBe('string');
      }
    }
  });

  it('the internal error message shows the correlation id as a reference', () => {
    expect(lookup(getMessages('ar'), PlatformErrors.INTERNAL_ERROR.messageKey)).toContain(
      '{correlationId}',
    );
    expect(lookup(getMessages('en'), PlatformErrors.INTERNAL_ERROR.messageKey)).toContain(
      '{correlationId}',
    );
  });
});
