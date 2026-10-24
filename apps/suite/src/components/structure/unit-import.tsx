'use client';
import type { UnitImportCheckView } from '@jadarat/platform-import';
import {
  Alert,
  Badge,
  Button,
  Card,
  Icon,
  buttonClasses,
  cn,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useState, useTransition } from 'react';
import { applyUnitImportAction, checkUnitImportAction } from '../../actions/unit-import';
import { fillText } from '../../lib/fill-text';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';

export interface UnitImportProps {
  /** Texts of the `structure` namespace (raw, flattened). */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
  readonly templateHref: string;
  readonly structureHref: string;
}

/** The file as sent (UNIT_IMPORT_MAX_BYTES in platform-import): checked here first to answer at once. */
const MAX_BYTES = 512 * 1024;

/** Bytes → base64 in chunks (no spread of a large array into one call). */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/**
 * Import units (WP-HR-01; design screen 7): 1 the template, 2 the file and «Check» — every row's result (new,
 * update, problem) with the reason; 3 «Import» writes the good rows in one go (problem rows are skipped and can be
 * fixed in the file and imported again). Nothing is written by the check, and no file is stored.
 */
export function UnitImport({
  texts,
  errors,
  locale,
  templateHref,
  structureHref,
}: UnitImportProps) {
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [check, setCheck] = useState<UnitImportCheckView | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function refusal(error: Parameters<typeof sessionRefused>[0]): string | null {
    if (sessionRefused(error)) return null;
    if (error.code === 'VALIDATION_FAILED') {
      const code = fieldErrorCodes(error).file;
      if (code) return texts[`import.file.${code}`] ?? text('import.file.FILE_UNREADABLE');
    }
    return errorText(error, errors);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    setCheck(null);
    setMessage(null);
    if (!picked) {
      setFile(null);
      return;
    }
    if (picked.size > MAX_BYTES) {
      setFile(null);
      setMessage(text('import.file.FILE_TOO_LARGE'));
      return;
    }
    const content = toBase64(new Uint8Array(await picked.arrayBuffer()));
    setFile({ name: picked.name, content });
  }

  function runCheck() {
    if (!file) return;
    setMessage(null);
    startTransition(async () => {
      const result = await checkUnitImportAction({ content: file.content });
      if (result.ok) {
        setCheck(result.value);
        setProblemsOnly(false);
      } else setMessage(refusal(result.error));
    });
  }

  function runImport() {
    if (!file) return;
    setMessage(null);
    startTransition(async () => {
      const result = await applyUnitImportAction({ content: file.content });
      if (result.ok) {
        toast.success(
          fill('import.done', { created: result.value.created, updated: result.value.updated }),
        );
        router.push(structureHref);
        router.refresh();
        return;
      }
      setMessage(refusal(result.error));
    });
  }

  const good = check ? check.counts.created + check.counts.updated : 0;
  const rows = check ? check.rows.filter((r) => !problemsOnly || r.result === 'problem') : [];
  const resultBadge = (result: 'new' | 'update' | 'problem') =>
    result === 'new' ? (
      <Badge tone="success">{text('import.result.new')}</Badge>
    ) : result === 'update' ? (
      <Badge tone="info">{text('import.result.update')}</Badge>
    ) : (
      <Badge tone="danger">{text('import.result.problem')}</Badge>
    );

  return (
    <div className="flex flex-col gap-5">
      <Card
        icon="download"
        title={text('import.templateTitle')}
        description={text('import.templateText')}
      >
        <div className="flex flex-wrap gap-2.5 p-4 sm:p-6">
          <a
            href={`${templateHref}?lang=${locale}`}
            className={buttonClasses({ variant: 'secondary' })}
            data-testid="unit-import-template"
          >
            <Icon name="download" />
            {text('import.templateDownload')}
          </a>
          <a
            href={`${templateHref}?lang=${locale === 'ar' ? 'en' : 'ar'}`}
            className={buttonClasses({ variant: 'ghost' })}
            data-testid="unit-import-template-other"
          >
            {text('import.templateOther')}
          </a>
        </div>
        <ul className="m-0 flex list-disc flex-col gap-1 border-t border-border px-10 py-4 text-sm text-text-muted">
          <li>{text('import.rule.order')}</li>
          <li>{text('import.rule.update')}</li>
          <li>{text('import.rule.noMove')}</li>
          <li>{text('import.rule.limits')}</li>
        </ul>
      </Card>

      <Card icon="upload" title={text('import.fileTitle')} description={text('import.fileText')}>
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="unit-import-file" className="sr-only">
              {text('import.choose')}
            </label>
            <input
              id="unit-import-file"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                void onFile(event);
              }}
              disabled={pending}
              className="max-w-full text-sm file:me-3 file:min-h-10 file:rounded-full file:border-[1.5px] file:border-border-strong file:bg-surface file:px-4 file:font-semibold"
              data-testid="unit-import-file"
            />
            <Button onClick={runCheck} disabled={pending || !file} data-testid="unit-import-check">
              {pending && !check ? text('import.checking') : text('import.check')}
            </Button>
          </div>
          {message ? (
            <Alert tone="danger" data-testid="unit-import-message">
              {message}
            </Alert>
          ) : null}
        </div>
      </Card>

      {check ? (
        <section
          aria-labelledby="unit-import-results-title"
          className="overflow-hidden rounded-xl border border-border bg-surface"
          data-testid="unit-import-results"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 px-5.5 pb-4 pt-5">
            <div className="min-w-0">
              <h2 id="unit-import-results-title" className="m-0 text-lg font-bold">
                {text('import.resultsTitle')}
              </h2>
              <p className="m-0 text-sm text-text-muted" aria-live="polite">
                {fill('import.summary', {
                  read: check.counts.read,
                  created: check.counts.created,
                  updated: check.counts.updated,
                  problems: check.counts.problems,
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {check.counts.problems > 0 ? (
                <Button
                  variant="ghost"
                  aria-pressed={problemsOnly}
                  onClick={() => {
                    setProblemsOnly((value) => !value);
                  }}
                  data-testid="unit-import-problems-only"
                >
                  <Icon name="filter" />
                  {text('import.problemsOnly')}
                </Button>
              ) : null}
              <Button
                onClick={runImport}
                disabled={pending || good === 0}
                data-testid="unit-import-apply"
              >
                {pending ? text('import.importing') : fill('import.apply', { count: good })}
              </Button>
            </div>
          </div>
          {check.counts.problems > 0 ? (
            <div className="px-5.5 pb-4">
              <Alert tone="warning" data-testid="unit-import-skipped">
                {fill('import.skipped', { count: check.counts.problems })}
              </Alert>
            </div>
          ) : null}
          <div
            className={`${tableClasses.wrapper} focus-visible:outline-2 focus-visible:outline-offset-2`}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
            tabIndex={0}
            role="region"
            aria-label={text('import.resultsTitle')}
          >
            <table className={tableClasses.table} data-testid="unit-import-table">
              <caption className="sr-only">{text('import.resultsTitle')}</caption>
              <thead className={tableClasses.header}>
                <tr>
                  {(['row', 'code', 'name', 'level', 'result', 'issue'] as const).map((column) => (
                    <th key={column} scope="col" className={tableClasses.head}>
                      {text(`import.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.row}
                    className={cn(
                      tableClasses.row,
                      row.result === 'problem' && 'bg-danger-subtle/40',
                    )}
                    data-testid={`unit-import-row-${String(row.row)}`}
                  >
                    <td className={`${tableClasses.cell} tabular-nums`}>{row.row}</td>
                    <td className={tableClasses.cell}>
                      <span dir="ltr" className="font-mono text-sm">
                        {row.code}
                      </span>
                    </td>
                    <td className={tableClasses.cell}>{row.name}</td>
                    <td className={tableClasses.cell}>{row.level}</td>
                    <td className={tableClasses.cell}>{resultBadge(row.result)}</td>
                    <td className={`${tableClasses.cell} text-sm`}>
                      {row.issue ? (texts[`import.issues.${row.issue}`] ?? row.issue) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
