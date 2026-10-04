import { readyResponse } from '../../../../lib/health';

export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return readyResponse();
}
