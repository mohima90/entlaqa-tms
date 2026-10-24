import { toClientError } from '@jadarat/platform-core';
import { unitTemplateFileName, unitTemplateXlsx } from '@jadarat/platform-import';
import { unitImportTemplateQuery } from '../../../../../../../lib/structure-queries';
import { attachmentDisposition } from '../../../../../../../lib/user-import-view';

export const dynamic = 'force-dynamic';

/**
 * The unit import template (WP-HR-01; FR-ADM-05; design screen 7): XLSX with the headers only, Arabic or English.
 * A read for the HR Manager (`platform.org.manage`): no file is stored.
 */
export async function GET(request: Request): Promise<Response> {
  const lang = new URL(request.url).searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const result = await unitImportTemplateQuery({});
  if (!result.ok) {
    const error = toClientError(result.error);
    const status = error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'FORBIDDEN' ? 403 : 500;
    return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(unitTemplateXlsx(lang), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': attachmentDisposition(unitTemplateFileName(lang)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
