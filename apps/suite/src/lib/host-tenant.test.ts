import { describe, expect, it } from 'vitest';
import { HOST_KIND_HEADER, HOST_REF_HEADER, applyHostHeaders, classifyHost } from './host-tenant';

describe('classifyHost', () => {
  const base = 'jadarat.example';

  it('treats local and base-domain hosts as the platform', () => {
    expect(classifyHost('localhost:3000', base)).toEqual({ kind: 'platform' });
    expect(classifyHost('127.0.0.1', base)).toEqual({ kind: 'platform' });
    expect(classifyHost('[::1]:3000', base)).toEqual({ kind: 'platform' });
    expect(classifyHost('Jadarat.Example.', base)).toEqual({ kind: 'platform' });
    expect(classifyHost('www.jadarat.example', base)).toEqual({ kind: 'platform' });
  });

  it('extracts a single-label tenant subdomain', () => {
    expect(classifyHost('al-raya.jadarat.example:443', base)).toEqual({
      kind: 'subdomain',
      slug: 'al-raya',
    });
    expect(classifyHost('a.b.jadarat.example', base)).toEqual({ kind: 'invalid' });
  });

  it('classifies other valid hosts as custom domains and rejects malformed ones', () => {
    expect(classifyHost('training.bank.example', base)).toEqual({
      kind: 'custom',
      hostname: 'training.bank.example',
    });
    expect(classifyHost('training.bank.example', undefined)).toEqual({
      kind: 'custom',
      hostname: 'training.bank.example',
    });
    expect(classifyHost(null, base)).toEqual({ kind: 'invalid' });
    expect(classifyHost('evil host/<script>', base)).toEqual({ kind: 'invalid' });
    expect(classifyHost('[::1', base)).toEqual({ kind: 'invalid' });
  });
});

describe('applyHostHeaders', () => {
  it('removes client-supplied proxy-owned headers before setting its own', () => {
    const headers = new Headers({
      'X-Jadarat-Host-Ref': 'victim-tenant',
      'x-jadarat-tenant-id': '22222222-2222-4222-8222-222222222222',
      accept: 'text/html',
    });
    applyHostHeaders(headers, { kind: 'platform' });
    expect(headers.get(HOST_KIND_HEADER)).toBe('platform');
    expect(headers.get(HOST_REF_HEADER)).toBeNull();
    expect(headers.get('x-jadarat-tenant-id')).toBeNull();
    expect(headers.get('accept')).toBe('text/html');

    applyHostHeaders(headers, { kind: 'subdomain', slug: 'al-raya' });
    expect(headers.get(HOST_REF_HEADER)).toBe('al-raya');
    applyHostHeaders(headers, { kind: 'custom', hostname: 'training.bank.example' });
    expect(headers.get(HOST_REF_HEADER)).toBe('training.bank.example');
  });
});
