import 'server-only';
import type { RequestClient } from '@jadarat/platform-identity';
import { headers } from 'next/headers';
import { UNKNOWN_CLIENT, clientAddress, clientRateKey } from './client-ip';

/**
 * The visitor's rate-limit key for the shared limiter (T-M2-11): the address from the header the platform
 * overwrites (lib/client-ip.ts — `x-real-ip` on Vercel, `JADARAT_CLIENT_IP_HEADER` elsewhere; TM-0003
 * T-IAM-03), IPv6 by its /64; null when there is no trusted address (every such visitor shares one key).
 * The address stays in memory: the limiter receives a hash of it, logs a keyed reference.
 */
export function requestClientFrom(
  header: (name: string) => string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RequestClient {
  const address = clientAddress(header, env);
  return { key: address === UNKNOWN_CLIENT ? null : clientRateKey(address) };
}

/** The current request's client (server actions and route handlers). */
export async function requestClient(): Promise<RequestClient> {
  const store = await headers();
  return requestClientFrom((name) => store.get(name));
}
