import { toClientError } from '@jadarat/platform-core';
import { csvTemplate, templateFileName, xlsxTemplate } from '@jadarat/platform-import';
import { userImportTemplateQuery } from '../../../../../../../lib/user-import-queries';
import { attachmentDisposition } from '../../../../../../../lib/user-import-view';

export const dynamic = 'force-dynamic';

const TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
} as const;

/**
 * The import template (T-M2-12, approved screens 2–3): XLSX (sheets «المستخدمون», «تعليمات», «القوائم» with
 * this organization's departments, branches and the roles an import may give) or CSV (headers only),
 * Arabic or English headers. A read for importers (`platform.user.invite`): no file is stored.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const result = await userImportTemplateQuery({});
  if (!result.ok) {
    const error = toClientError(result.error);
    const status = error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'FORBIDDEN' ? 403 : 500;
    return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  const bytes = format === 'csv' ? csvTemplate(lang) : xlsxTemplate(lang, result.value);
  return new Response(bytes, {
    headers: {
      'Content-Type': TYPES[format],
      'Content-Disposition': attachmentDisposition(templateFileName(lang, format)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
