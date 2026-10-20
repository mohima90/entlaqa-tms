import { requestWorkerPass } from '@jadarat/platform-jobs/kick';
import { handleCronJobsRequest } from '../../../../lib/cron-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Vercel Cron, every minute: ask GitHub for a worker pass (lib/cron-jobs.ts; Bearer CRON_SECRET). */
export function GET(request: Request): Promise<Response> {
  return handleCronJobsRequest(request, { requestWorkerPass });
}
