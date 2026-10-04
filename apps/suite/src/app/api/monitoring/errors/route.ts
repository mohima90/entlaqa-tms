import { definePublicRoute } from '@jadarat/platform-rbac';
import { handleErrorTunnel } from '../../../../lib/error-tunnel';

export const dynamic = 'force-dynamic';

/** Browser error reports (public by design; bounded and scrubbed in lib/error-tunnel.ts). */
export const POST = definePublicRoute({
  name: 'platform.observability.browser_error',
  handler: (request) => handleErrorTunnel(request),
});
