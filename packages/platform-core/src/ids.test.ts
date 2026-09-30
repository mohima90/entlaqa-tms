import { describe, expect, it } from 'vitest';
import { isUuid, parseUuid } from './ids';

describe('uuid helpers', () => {
  it('accepts canonical UUIDs only', () => {
    expect(isUuid('7d0f3c7e-1a2b-4c3d-8e9f-0123456789ab')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(parseUuid('7D0F3C7E-1A2B-4C3D-8E9F-0123456789AB')).not.toBeNull();
    expect(parseUuid("' or 1=1 --")).toBeNull();
  });
});
