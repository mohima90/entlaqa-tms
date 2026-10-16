import 'server-only';
import { headers } from 'next/headers';
import { originFromHost, parseAppBaseUrl } from './app-base-url';

/** The public origin for copied links: APP_BASE_URL, else this request's host (lib/app-base-url.ts). */
export async function appBaseUrlForRequest(): Promise<string | null> {
  return parseAppBaseUrl(process.env.APP_BASE_URL) ?? originFromHost((await headers()).get('host'));
}
