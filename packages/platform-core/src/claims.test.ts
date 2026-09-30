import { describe, expect, it } from 'vitest';
import { hasTenant } from './claims';
import { brandVerifiedClaims } from './internal/verified-claims';

const base = { sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated', aal: 'aal1' };

describe('verified claims', () => {
  it('brands a well-formed verified payload and preserves unknown claims', () => {
    const result = brandVerifiedClaims({ ...base, email: 'a@example.test' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBe('a@example.test');
  });

  it('rejects payloads without a UUID subject or with a malformed tenant claim', () => {
    expect(brandVerifiedClaims({ role: 'authenticated' }).ok).toBe(false);
    expect(brandVerifiedClaims({ ...base, tenant_id: 'tenant-b' }).ok).toBe(false);
    expect(brandVerifiedClaims(null).ok).toBe(false);
  });

  it('detects whether claims carry a tenant', () => {
    const withTenant = brandVerifiedClaims({
      ...base,
      tenant_id: '22222222-2222-4222-8222-222222222222',
    });
    const without = brandVerifiedClaims(base);
    expect(withTenant.ok && hasTenant(withTenant.value)).toBe(true);
    expect(without.ok && hasTenant(without.value)).toBe(false);
  });
});
