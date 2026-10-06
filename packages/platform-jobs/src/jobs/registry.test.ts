import { describe, expect, it } from 'vitest';
import { type Subscriber, createSubscriberRegistry } from './registry';

const subscriber = (name: string, types: readonly string[]): Subscriber => ({
  name,
  types,
  handle: () => Promise.resolve(),
});

describe('createSubscriberRegistry', () => {
  it('finds subscribers by event type and by name', () => {
    const a = subscriber('notifications.email', ['com.entlaqa.platform.invitation.created']);
    const b = subscriber('audit-projector@v2', [
      'com.entlaqa.platform.invitation.created',
      'com.entlaqa.tms.session.cancelled',
    ]);
    const registry = createSubscriberRegistry([a, b]);
    expect(registry.forType('com.entlaqa.platform.invitation.created')).toEqual([a, b]);
    expect(registry.forType('com.entlaqa.tms.session.cancelled')).toEqual([b]);
    expect(registry.forType('com.entlaqa.tms.session.created')).toEqual([]);
    expect(registry.get('audit-projector@v2')).toBe(b);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.names).toEqual(['notifications.email', 'audit-projector@v2']);
  });

  it('rejects invalid names, duplicates, empty and invalid types', () => {
    const type = ['com.entlaqa.platform.x.y'];
    expect(() => createSubscriberRegistry([subscriber('Bad Name', type)])).toThrow(/invalid/);
    expect(() => createSubscriberRegistry([subscriber('a'.repeat(101), type)])).toThrow(/invalid/);
    expect(() => createSubscriberRegistry([subscriber('a', type), subscriber('a', type)])).toThrow(
      /twice/,
    );
    expect(() => createSubscriberRegistry([subscriber('a', [])])).toThrow(/no event types/);
    expect(() => createSubscriberRegistry([subscriber('a', ['platform.x.y'])])).toThrow(
      /invalid event type/,
    );
  });
});
