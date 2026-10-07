import { isIP } from 'node:net';

/** All clients share this key when the platform gives no trustworthy client address. */
export const UNKNOWN_CLIENT = 'unknown';

/**
 * The client address for application rate limits (TM-0003 T-IAM-03): only a client-IP header that the
 * platform in front of the app OVERWRITES — `x-real-ip` on Vercel (trusted automatically there);
 * elsewhere only the header named in `JADARAT_CLIENT_IP_HEADER` (set it only when a load balancer
 * overwrites that header). Otherwise, or when the value is not a single IP address, UNKNOWN_CLIENT: a
 * client-sent header can never mint keys. The address stays in memory only and is never logged.
 */
export function clientAddress(
  header: (name: string) => string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env.JADARAT_CLIENT_IP_HEADER?.trim();
  const name =
    configured !== undefined && configured !== ''
      ? configured
      : env.VERCEL === '1'
        ? 'x-real-ip'
        : undefined;
  if (name === undefined) return UNKNOWN_CLIENT;
  const value = header(name)?.trim() ?? '';
  return isIP(value) === 0 ? UNKNOWN_CLIENT : value;
}

/** The eight 16-bit groups of a valid IPv6 address (zone dropped, embedded IPv4 converted). */
function ipv6Groups(address: string): number[] | null {
  let text = address.split('%')[0] ?? '';
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(Math.max(fill, 0)).fill('0'), ...tail].map((group) =>
    Number.parseInt(group, 16),
  );
  return groups.length === 8 && groups.every((group) => group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

/**
 * The rate-limit key of a client address: IPv4 as is; IPv6 by its /64 — one subscriber usually holds a
 * whole /64, so per-address keys would let one client rotate freely (security review M, T-M2-08). An
 * IPv4-mapped IPv6 address counts as its IPv4 address. Anything else is returned unchanged.
 */
export function clientRateKey(address: string): string {
  if (isIP(address) !== 6) return address;
  const groups = ipv6Groups(address);
  if (!groups) return address;
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join('.');
  }
  return `${[g0, g1, g2, g3].map((group = 0) => group.toString(16)).join(':')}::/64`;
}
