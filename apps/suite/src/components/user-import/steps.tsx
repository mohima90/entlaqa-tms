import 'server-only';
import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import {
  IMPORT_FIELDS,
  IMPORTABLE_ROLES,
  type ImportIssue,
  type UserImportView,
  issueMessage,
  parseIssues,
  roleName,
} from '@jadarat/platform-import';
import { Alert, Badge, type BadgeTone, Card, Icon, buttonClasses } from '@jadarat/ui';
import { FocusedActions } from '../focused-actions';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { fileActionErrorTexts, profileErrorTexts } from '../../lib/profile-texts';
import { userImportRowsQuery } from '../../lib/user-import-queries';
import {
  codeCounts,
  count,
  isolate,
  largestSheet,
  mayUndo,
  megabytes,
  optionsFromParams,
  runningPhase,
  undoDeadline,
  undoSummary,
} from '../../lib/user-import-view';
import { localizedName } from '../../lib/users-view';
import { CancelDraftButton } from './cancel-draft-button';
import { ConfirmActions } from './confirm-actions';
import { type MappingColumn, MappingForm, type MappingSheet } from './mapping-form';
import { DefaultRoleSelect, ExistingChoiceCards, InvitationsChoiceCards } from './options-form';
import { ReportDownloadButton } from './report-download-button';
import { SendInvitationsButton } from './send-invitations-button';
import { StopImportButton } from './stop-import-button';
import { UndoImportDialog } from './undo-import-dialog';

type SearchParams = Record<string, string | string[] | undefined>;

const base = (locale: AppLocale) => `/${locale}/suite/admin/users/import`;
const one = (query: SearchParams, key: string) => {
  const raw = query[key];
  return Array.isArray(raw) ? raw[0] : raw;
};

/** Every string of a message subtree, flattened to dotted keys (raw: placeholders left for the client). */
function flatten(tree: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof tree !== 'object' || tree === null) return out;
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    if (typeof value === 'string') out[`${prefix}${key}`] = value;
    else Object.assign(out, flatten(value, `${prefix}${key}.`));
  }
  return out;
}

async function importer(locale: AppLocale, view: UserImportView): Promise<string> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const { record } = view;
  if (record.mine) return t('recent.you');
  // A person may have an English name only (PO 17 Oct 2026).
  return (record.importerName.ar ?? record.importerName.en)
    ? localizedName(locale, record.importerName.ar, record.importerName.en)
    : '—';
}

/** Codes of refusals the action buttons may show (namespace `userImport.confirm.errors`). */
async function refusalCodes(locale: AppLocale): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  return t.raw('confirm.errors') as Record<string, string>;
}

// ---------------------------------------------------------------------------------------------------
// Step 1 states: scanning, reading; the dry run running
// ---------------------------------------------------------------------------------------------------

export async function fileState(
  locale: AppLocale,
  view: UserImportView,
  dates: DisplayDateFormatter,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const { record } = view;
  if (record.status === 'uploaded' && record.fileStatus === 'pending_upload') {
    // Integration review M1: «إعادة الرفع» cancels this import first (it no longer waits for its window to
    // end), and it can be cancelled on its own.
    const codes = await refusalCodes(locale);
    const errors = await fileActionErrorTexts(locale);
    return (
      <Alert tone="warning" title={t('fileStates.uploadCut.title')} data-testid="import-upload-cut">
        <p className="m-0">{t('fileStates.uploadCut.body')}</p>
        {record.mine ? (
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <CancelDraftButton
              importId={record.id}
              label={t('fileStates.uploadCut.retry')}
              workingLabel={t('progress.working')}
              then={base(locale)}
              variant="primary"
              codes={codes}
              errors={errors}
              testId="upload-cut-retry"
            />
            <CancelDraftButton
              importId={record.id}
              label={t('confirm.cancel')}
              workingLabel={t('progress.working')}
              confirm={{
                question: t('confirm.cancelConfirm'),
                confirmButton: t('confirm.cancelConfirmButton'),
                keep: t('confirm.keep'),
              }}
              variant="ghost"
              codes={codes}
              errors={errors}
              testId="upload-cut-cancel"
            />
          </div>
        ) : (
          <a
            href={base(locale)}
            className={`${buttonClasses({ variant: 'secondary', size: 'md' })} mt-3`}
          >
            {t('fileStates.uploadCut.retry')}
          </a>
        )}
      </Alert>
    );
  }
  const slow = Date.now() - record.createdAt.getTime() > 2 * 60_000;
  const [title, hint] =
    record.status === 'validating'
      ? [t('fileStates.validating'), t('fileStates.validatingHint')]
      : record.fileStatus === 'clean'
        ? [t('fileStates.reading'), t('fileStates.readingHint')]
        : slow
          ? [t('fileStates.scanSlow'), t('fileStates.scanSlowHint')]
          : [t('fileStates.scanning'), t('fileStates.scanningHint')];
  return (
    <Card data-testid="import-file-state">
      <p className="m-0 font-medium">
        <bdi>{record.fileName}</bdi>
      </p>
      <p className="mb-3 mt-0 text-sm text-text-muted">
        {t('upload.megabytes', { value: megabytes(record.fileSize) })} ·{' '}
        {dates.dateTime(record.createdAt)}
      </p>
      <p className="mb-1 mt-0 text-lg font-semibold" data-testid="import-file-state-title">
        {title}
      </p>
      <div
        role="progressbar"
        aria-label={t('fileStates.progressLabel')}
        aria-valuetext={title}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <div className="h-full w-1/3 animate-pulse bg-primary" />
      </div>
      <p className="mb-0 mt-2 text-sm text-text-muted">{hint}</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------
// Step 2: the mapping
// ---------------------------------------------------------------------------------------------------

export async function mappingStep(locale: AppLocale, view: UserImportView): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const { record } = view;
  const sheets: MappingSheet[] = record.sheets.map((sheet, index) => {
    const name = sheet.name ? isolate(sheet.name) : t('mapping.sheetUnnamed', { index: index + 1 });
    const usable = sheet.rows >= 1 && sheet.rows <= view.maxRows;
    return {
      index,
      usable,
      label:
        sheet.rows < 1
          ? t('mapping.sheetEmpty', { name })
          : sheet.rows > view.maxRows
            ? t('mapping.sheetOverLimit', { name })
            : t('mapping.sheetOption', { name, rows: sheet.rows }),
    };
  });
  const initialSheet =
    sheets.find((s, i) => s.usable && record.sheets[i]?.hidden !== true)?.index ??
    sheets.find((s) => s.usable)?.index ??
    0;
  const columns: MappingColumn[] = view.columns.map((c) => ({
    sheetIndex: c.sheetIndex,
    index: c.index,
    header: c.header,
    samples: c.samples,
    recognition: c.recognition,
  }));
  const suggestions = columns.filter(
    (c) =>
      c.sheetIndex === (record.sheetIndex ?? initialSheet) && c.recognition.kind === 'suggested',
  ).length;
  const labels = flatten(t.raw('mapping'));
  labels.suggestionsIntro = t('mapping.suggestionsIntro', { count: suggestions });
  return (
    <section aria-labelledby="mapping-heading" className="flex flex-col gap-4">
      <h1 id="mapping-heading" className="m-0 text-[28px] font-bold md:text-5xl">
        {t('mapping.heading')}
      </h1>
      <p className="m-0 text-sm text-text-muted">
        {t('mapping.file', { name: isolate(record.fileName) })}
      </p>
      <MappingForm
        importId={record.id}
        sheets={sheets}
        initialSheet={initialSheet}
        columns={columns}
        fields={IMPORT_FIELDS.map((field) => ({ field, label: t(`fields.${field}`) }))}
        required={view.required}
        chosen={record.status === 'review' ? record.mapping : null}
        chosenSheet={record.status === 'review' ? record.sheetIndex : null}
        labels={labels}
        errors={await profileErrorTexts(locale)}
        backHref={record.status === 'review' ? '?step=review' : base(locale)}
        locale={locale}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// Step 3: the review (dry run)
// ---------------------------------------------------------------------------------------------------

const SEVERITY_TONE: Record<string, BadgeTone> = {
  e: 'danger',
  w: 'warning',
  k: 'neutral',
  i: 'info',
};
const SEVERITY_KIND: Record<string, string> = { e: 'error', w: 'warning', k: 'skip', i: 'info' };
const VIEWS = ['errors', 'warnings', 'existing', 'skipped', 'all'] as const;

/** The file's header of the column mapped to `field` (the review says «العمود: Email»). */
function columnOf(view: UserImportView, field: string | undefined): string | null {
  if (!field || view.record.mapping === null) return null;
  const entry = Object.entries(view.record.mapping).find(([, f]) => f === field);
  if (!entry) return null;
  const header = view.columns.find(
    (c) => c.sheetIndex === view.record.sheetIndex && c.index === Number(entry[0]),
  )?.header;
  return header ?? null;
}

async function issueList(
  locale: AppLocale,
  view: UserImportView,
  issues: readonly ImportIssue[],
  phase: 'review' | 'result',
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {issues.map((issue, i) => {
        const column = columnOf(view, issue.f);
        return (
          <li key={`${issue.c}-${String(i)}`}>
            <Badge tone={SEVERITY_TONE[issue.s] ?? 'neutral'}>
              {t(`review.kind.${SEVERITY_KIND[issue.s] ?? 'info'}`)}
            </Badge>{' '}
            <span>{issueMessage(issue, locale, phase)}</span>
            {column ? (
              <div className="text-sm text-text-muted">{t('review.column', { column })}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export async function reviewStep(
  locale: AppLocale,
  view: UserImportView,
  query: SearchParams,
  dates: DisplayDateFormatter,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const format = await getFormatter({ locale });
  const { record } = view;
  const counts = record.reviewCounts;
  if (record.reviewExpiresAt.getTime() <= Date.now()) {
    return (
      <Card title={t('review.expired.title')} data-testid="import-review-expired">
        <p className="mt-0">{t('review.expired.body')}</p>
        <a href={base(locale)} className={buttonClasses({ variant: 'primary', size: 'md' })}>
          {t('review.expired.upload')}
        </a>
      </Card>
    );
  }
  const requested = one(query, 'view');
  const current = (VIEWS as readonly string[]).includes(requested ?? '')
    ? (requested as (typeof VIEWS)[number])
    : count(counts, 'errors') > 0
      ? 'errors'
      : 'all';
  const code = one(query, 'code');
  const page = Math.max(1, Number(one(query, 'page') ?? '1') || 1);
  const rows = await userImportRowsQuery({
    importId: record.id,
    view: current,
    ...(code && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? { code } : {}),
    page,
  });
  const ready = count(counts, 'new') + count(counts, 'existing');
  const href = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { view: current, code, page: String(page), ...changes };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && !(key === 'page' && value === '1')) params.set(key, value);
    }
    return `?${params.toString()}`;
  };
  const group = (title: string, key: string, tab: string) => {
    const entries = codeCounts(counts, key);
    if (entries.length === 0) return null;
    return (
      <section aria-label={title} className="flex flex-col gap-2">
        <h3 className="m-0 text-base font-semibold">{title}</h3>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {entries.map((entry) => (
            <li key={entry.code} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">{t(`codes.${entry.code}`)}</span>
              <span className="font-semibold">{format.number(entry.rows, 'integer')}</span>
              <a
                href={href({ view: tab, code: entry.code, page: undefined })}
                className="underline"
              >
                {t('review.showRows')}
                <span className="sr-only">{` (${t(`codes.${entry.code}`)})`}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  let table: ReactNode;
  if (!rows.ok) {
    table = (
      <Alert tone="danger">
        {t('loadFailed', { correlationId: rows.error.correlationId ?? '' })}
      </Alert>
    );
  } else if (rows.value.rows.length === 0) {
    table = <p className="m-0">{t('review.emptyTab')}</p>;
  } else {
    const from = (rows.value.page - 1) * rows.value.pageSize + 1;
    const to = from + rows.value.rows.length - 1;
    const fieldName = (field: string) =>
      field === 'manager'
        ? t('fields.manager_email')
        : (IMPORT_FIELDS as readonly string[]).includes(field)
          ? t(`fields.${field as (typeof IMPORT_FIELDS)[number]}`)
          : field;
    const rendered = await Promise.all(
      rows.value.rows.map(async (row) => {
        const issues = parseIssues(row.issues);
        const changes = (
          Array.isArray(row.changes)
            ? (row.changes as { f?: unknown; from?: unknown; to?: unknown }[])
            : []
        ).map((c) => ({
          field: fieldName(typeof c.f === 'string' ? c.f : ''),
          from: typeof c.from === 'string' ? c.from : null,
          to: typeof c.to === 'string' ? c.to : '',
        }));
        let detail: ReactNode;
        if (row.kind === 'existing' && issues.every((i) => i.s !== 'w')) {
          detail =
            changes.length === 0 ? (
              <span>{t('review.existingNoChanges')}</span>
            ) : (
              <span>
                {t('review.existingChanges', {
                  changes: changes
                    .map((c) =>
                      c.from === null
                        ? t('review.changeItemNew', { field: c.field, to: c.to })
                        : t('review.changeItem', { field: c.field, from: c.from, to: c.to }),
                    )
                    .join(locale === 'ar' ? '، ' : ', '),
                })}
              </span>
            );
        } else if (issues.length === 0) {
          detail = <span>{t('review.readyNew')}</span>;
        } else {
          detail = await issueList(locale, view, issues, 'review');
        }
        return (
          <tr key={row.rowNumber} className="border-t border-border align-top">
            <th scope="row" className="whitespace-nowrap px-4 py-3 text-start font-medium">
              {format.number(row.rowNumber, 'integer')}
            </th>
            <td className="whitespace-nowrap px-4 py-3 text-sm">
              {row.email ? <bdi dir="ltr">{row.email}</bdi> : '—'}
            </td>
            <td className="min-w-40 px-4 py-3">
              {(row.nameAr ?? row.nameEn)
                ? localizedName(locale, row.nameAr, row.nameEn)
                : t('review.noName')}
            </td>
            <td className="min-w-72 px-4 py-3">{detail}</td>
          </tr>
        );
      }),
    );
    table = (
      <>
        <div className="max-h-[36rem] overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-start" data-testid="review-table">
            <caption className="sr-only">
              {t('review.caption', { tab: t(`review.tabs.${current}`) })}
            </caption>
            <thead className="sticky top-0 bg-surface-sunken text-sm">
              <tr>
                {(['row', 'email', 'name', 'problem'] as const).map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="whitespace-nowrap px-4 py-3 text-start font-semibold"
                  >
                    {t(`review.columns.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{rendered}</tbody>
          </table>
        </div>
        <nav
          aria-label={t('review.pagination')}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="m-0 text-sm text-text-muted">
            {t('review.pageRange', { from, to, total: rows.value.total })}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <a
                href={href({ page: String(page - 1) })}
                rel="prev"
                className={buttonClasses({ variant: 'secondary', size: 'md' })}
              >
                {t('review.pagePrevious')}
              </a>
            ) : null}
            {to < rows.value.total ? (
              <a
                href={href({ page: String(page + 1) })}
                rel="next"
                className={buttonClasses({ variant: 'secondary', size: 'md' })}
              >
                {t('review.pageNext')}
              </a>
            ) : null}
          </div>
        </nav>
      </>
    );
  }

  const tabCounts: Record<(typeof VIEWS)[number], number> = {
    errors: count(counts, 'errors'),
    warnings: count(counts, 'warnings'),
    existing: count(counts, 'existing'),
    skipped: count(counts, 'skipped'),
    all: count(counts, 'total'),
  };

  // Redesign package 3 (Customer.io's KPI strip): the four counts are the filters — each tile shows its rows
  // (New → every row). Warnings stay reachable from their group's «Show rows» and the confirmation.
  const tiles = [
    {
      key: 'new',
      view: 'all',
      hint: 'newHint',
      value: count(counts, 'new'),
      values: { warnings: count(counts, 'newWithWarnings') },
      tone: 'text-success',
    },
    {
      key: 'existing',
      view: 'existing',
      hint: 'existingHint',
      value: count(counts, 'existing'),
      values: {},
      tone: 'text-text',
    },
    {
      key: 'skipped',
      view: 'skipped',
      hint: 'skippedHint',
      value: count(counts, 'skipped'),
      values: {},
      tone: 'text-text',
    },
    {
      key: 'errors',
      view: 'errors',
      hint: 'errorsHint',
      value: count(counts, 'errors'),
      values: {},
      tone: 'text-danger',
    },
  ] as const;

  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-5" data-testid="review">
      <div>
        <h1 id="review-heading" className="m-0 text-[28px] font-bold md:text-5xl">
          {t('review.heading')}
        </h1>
        <p className="mb-0 mt-2 text-text-muted">
          {t('review.intro', { total: count(counts, 'total'), name: isolate(record.fileName) })}
        </p>
      </div>

      <nav aria-label={t('review.tabs.label')} data-testid="review-counts">
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => {
            const isCurrent = tile.view === current;
            return (
              <li key={tile.key} className="min-w-0">
                <a
                  href={href({ view: tile.view, code: undefined, page: undefined })}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`flex h-full flex-col gap-0.5 rounded-lg border-[1.5px] bg-surface px-4.5 py-4 text-text no-underline transition-colors hover:border-border-strong ${
                    isCurrent ? 'border-primary shadow-2' : 'border-border'
                  }`}
                >
                  <span
                    className={`text-[28px] font-bold leading-tight tabular-nums ${tile.tone}`}
                    data-testid={`review-count-${tile.key}`}
                  >
                    {format.number(tile.value, 'integer')}
                  </span>
                  <span className="font-semibold">{t(`review.cards.${tile.key}`)}</span>
                  <span className="text-sm text-text-muted">
                    {t(`review.cards.${tile.hint}`, tile.values)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {count(counts, 'defaultRole') > 0 ? (
        <Alert tone="info">
          {t('review.defaultRoleNote', { count: count(counts, 'defaultRole') })}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {group(t('review.errorsGroup'), 'errorCodes', 'errors')}
        {group(t('review.warningsGroup'), 'warningCodes', 'warnings')}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0 font-medium" data-testid="review-view">
          {t(`review.tabs.${current}`)}{' '}
          <Badge>{format.number(tabCounts[current], 'integer')}</Badge>
        </p>
        {code ? (
          <p className="m-0 text-sm">
            {t('review.filteredBy', { reason: t(`codes.${code}` as 'codes.EMAIL_INVALID') })}{' '}
            <a href={href({ code: undefined, page: undefined })} className="underline">
              {t('review.clearFilter')}
            </a>
          </p>
        ) : null}
        {record.reviewFileId ? (
          <div className="ms-auto">
            <ReportDownloadButton
              importId={record.id}
              which="review"
              label={t('review.downloadProblems')}
              workingLabel={t('progress.working')}
              codes={await refusalCodes(locale)}
              errors={await fileActionErrorTexts(locale)}
            />
          </div>
        ) : null}
      </div>
      {table}

      {ready === 0 ? (
        <Card title={t('review.nothingReady.title')} data-testid="import-nothing-ready">
          <p className="m-0">{t('review.nothingReady.body')}</p>
        </Card>
      ) : (
        <p className="m-0 text-sm text-text-muted">
          {t('review.continueNote', { date: dates.dateTime(record.reviewExpiresAt) })}
        </p>
      )}
      <FocusedActions
        start={
          <a href={base(locale)} className={buttonClasses({ variant: 'ghost', size: 'md' })}>
            <Icon name="upload" className="size-4" />
            {t('review.uploadCorrected')}
          </a>
        }
      >
        <a href="?step=mapping" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {t('review.changeMapping')}
        </a>
        {ready > 0 ? (
          <a
            href="?step=confirm"
            className={buttonClasses({ variant: 'primary', size: 'md' })}
            data-testid="review-next"
          >
            {t('options.next')}
            <Icon name="arrow-end" />
          </a>
        ) : null}
      </FocusedActions>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// Step 4: confirmation, with the options next to the counts they change (redesign package 3)
// ---------------------------------------------------------------------------------------------------

/** One count and what it means (the confirmation's tiles). */
function CountLine({
  value,
  tone = 'brand',
  children,
}: {
  readonly value: string;
  readonly tone?: 'brand' | 'danger' | 'neutral';
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <span
        className={`grid min-h-12 min-w-16 shrink-0 place-items-center rounded-md px-3 text-xl font-bold tabular-nums ${
          tone === 'danger'
            ? 'bg-danger-subtle text-danger'
            : tone === 'neutral'
              ? 'bg-surface-sunken text-text'
              : 'bg-primary-subtle text-primary-text'
        }`}
      >
        {value}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 pt-1.5">{children}</div>
    </div>
  );
}

export async function confirmStep(
  locale: AppLocale,
  view: UserImportView,
  query: SearchParams,
  organization: string,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const format = await getFormatter({ locale });
  // The options travel in the address, as before; without them the defaults (the old Options step's).
  const options = optionsFromParams(query) ?? {
    existing: 'skip' as const,
    defaultRole: 'learner',
    invitations: 'send' as const,
  };
  const { record } = view;
  const counts = record.reviewCounts;
  const newCount = count(counts, 'new');
  const existingCount = count(counts, 'existing');
  const optionLabels = flatten(t.raw('options'));
  optionLabels.existingHeading = t('options.existingHeading', { count: existingCount });
  optionLabels.defaultRoleHint = t('options.defaultRoleHint', {
    count: count(counts, 'defaultRole'),
  });
  const number = (value: number) => format.number(value, 'integer');

  const roleCounts = new Map<string, number>(
    Object.entries((counts?.roles as Record<string, unknown> | undefined) ?? {}).map(([k, v]) => [
      k,
      Number(v),
    ]),
  );
  const defaults = count(counts, 'defaultRole');
  if (defaults > 0)
    roleCounts.set(options.defaultRole, (roleCounts.get(options.defaultRole) ?? 0) + defaults);
  const additional = Object.keys(
    (counts?.additionalRoles as Record<string, unknown> | undefined) ?? {},
  );

  const statements: ReactNode[] = [];
  const newStatement =
    options.existing === 'update_only' ? (
      t('confirm.newSkipped', { count: newCount })
    ) : (
      <>
        {t(options.invitations === 'send' ? 'confirm.newSend' : 'confirm.newHold', {
          count: newCount,
          organization,
        })}
        {count(counts, 'newWithWarnings') > 0
          ? ` ${t('confirm.newWarnings', { count: count(counts, 'newWithWarnings') })}`
          : ''}{' '}
        {count(counts, 'newWithWarnings') > 0 ? (
          <a href="?step=review&view=warnings" className="underline">
            {t('confirm.showWarnings')}
          </a>
        ) : null}
      </>
    );
  statements.push(newStatement);
  const existingStatement =
    existingCount > 0 ? (
      <>
        {options.existing === 'skip'
          ? t('confirm.existingSkip', { count: existingCount })
          : t('confirm.existingUpdate', {
              count: existingCount,
              changed: count(counts, 'existingWithChanges'),
            })}
        {options.existing !== 'skip' &&
        view.privilegedAccess === 'denied' &&
        count(counts, 'existingPrivileged') > 0
          ? ` ${t('confirm.existingPrivileged', { count: count(counts, 'existingPrivileged') })}`
          : ''}
      </>
    ) : null;
  if (existingStatement) statements.push(existingStatement);
  if (count(counts, 'skipped') > 0)
    statements.push(t('confirm.skipped', { count: count(counts, 'skipped') }));
  if (count(counts, 'errors') > 0) {
    statements.push(
      <>
        {t('confirm.errorRows', { count: count(counts, 'errors') })}{' '}
        <a href="?step=review&view=errors" className="underline">
          {t('confirm.showErrors')}
        </a>
      </>,
    );
  }

  return (
    <section
      aria-labelledby="confirm-heading"
      className="flex flex-col gap-5"
      data-testid="confirm"
    >
      <div>
        <h1 id="confirm-heading" className="m-0 text-[28px] font-bold md:text-5xl">
          {t('confirm.heading')}
        </h1>
        <p className="mb-0 mt-2 text-text-muted">{t('confirm.intro')}</p>
      </div>
      {/* Every consequence in one list for screen readers and the summary; the cards repeat them next to
          the choices that change them. */}
      <ul className="sr-only" data-testid="confirm-statements">
        {statements.map((statement, i) => (
          <li key={i}>{statement}</li>
        ))}
      </ul>

      {options.existing !== 'update_only' ? (
        <Card title={t('options.invitationsHeading')} headingLevel={2}>
          <div className="flex flex-col gap-4">
            <CountLine value={number(newCount)}>
              <span>{newStatement}</span>
            </CountLine>
            <InvitationsChoiceCards options={options} labels={optionLabels} />
            <p className="m-0 text-sm text-text-muted">
              {t('options.invitationsNote', { organization })}
            </p>
          </div>
        </Card>
      ) : null}

      {existingCount > 0 ? (
        <Card title={optionLabels.existingHeading} headingLevel={2}>
          <div className="flex flex-col gap-4">
            <CountLine value={number(existingCount)} tone="neutral">
              <span>{existingStatement}</span>
              <span className="text-sm text-text-muted">{t('options.existingHint')}</span>
            </CountLine>
            <ExistingChoiceCards
              options={options}
              canUpdate={view.canUpdate}
              labels={optionLabels}
            />
            <p className="m-0 text-sm text-text-muted">{t('options.existingNote')}</p>
          </div>
        </Card>
      ) : null}

      {options.existing !== 'update_only' ? (
        <Card title={t('confirm.rolesHeading')} headingLevel={2}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DefaultRoleSelect
              options={options}
              roles={IMPORTABLE_ROLES.map((role) => ({ code: role.code, name: role.name[locale] }))}
              labels={optionLabels}
            />
            {roleCounts.size > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-start">
                  <caption className="sr-only">{t('confirm.rolesCaption')}</caption>
                  <thead className="text-sm text-text-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">
                        {t('confirm.rolesColumns.role')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-end font-semibold">
                        {t('confirm.rolesColumns.count')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...roleCounts.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([code, n]) => (
                        <tr key={code} className="border-t border-border">
                          <th scope="row" className="px-3 py-2 text-start font-medium">
                            {roleName(code, locale)}
                          </th>
                          <td className="px-3 py-2 text-end font-semibold">
                            {code === options.defaultRole && defaults > 0
                              ? t('confirm.roleDefaultCount', { count: n, defaults })
                              : number(n)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
          <p className="mb-0 mt-4 text-sm text-text-muted">
            {additional.length > 0
              ? t('confirm.additionalRoles', {
                  roles: additional
                    .map((code) => roleName(code, locale))
                    .join(locale === 'ar' ? '، ' : ', '),
                })
              : t('confirm.noAdditionalRoles')}
          </p>
        </Card>
      ) : null}

      {count(counts, 'skipped') > 0 || count(counts, 'errors') > 0 ? (
        <Card title={`${t('review.cards.skipped')} · ${t('review.cards.errors')}`} headingLevel={2}>
          <div className="flex flex-col gap-4">
            {count(counts, 'skipped') > 0 ? (
              <CountLine value={number(count(counts, 'skipped'))} tone="neutral">
                <span>{t('confirm.skipped', { count: count(counts, 'skipped') })}</span>
              </CountLine>
            ) : null}
            {count(counts, 'errors') > 0 ? (
              <CountLine value={number(count(counts, 'errors'))} tone="danger">
                <span>
                  {t('confirm.errorRows', { count: count(counts, 'errors') })}{' '}
                  <a href="?step=review&view=errors" className="underline">
                    {t('confirm.showErrors')}
                  </a>
                </span>
              </CountLine>
            ) : null}
          </div>
        </Card>
      ) : null}

      <ul className="m-0 flex flex-col gap-1 ps-5 text-sm text-text-muted">
        <li>{t('confirm.notes.recheck')}</li>
        <li>{t('confirm.notes.audit')}</li>
        <li>{t('confirm.notes.undo')}</li>
      </ul>
      <ConfirmActions
        importId={record.id}
        options={options}
        backHref="?step=review"
        cancelledHref={`/${locale}/suite/admin/users`}
        labels={flatten(t.raw('confirm'))}
        codes={await refusalCodes(locale)}
        errors={await profileErrorTexts(locale)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// The run and the undo in progress
// ---------------------------------------------------------------------------------------------------

export async function progressView(
  locale: AppLocale,
  view: UserImportView,
  dates: DisplayDateFormatter,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const { record } = view;
  const person = await importer(locale, view);
  const started = dates.dateTime(record.startedAt ?? record.confirmedAt ?? record.createdAt);
  if (record.status === 'undoing') {
    return (
      <section
        aria-labelledby="progress-heading"
        className="flex flex-col gap-4"
        data-testid="import-progress"
      >
        <h1 id="progress-heading" className="m-0 text-2xl font-bold">
          {t('progress.undoHeading')}
        </h1>
        <p className="m-0 text-sm text-text-muted">
          {t('progress.startedBy', {
            name: isolate(record.fileName),
            date: started,
            person: isolate(person),
          })}
        </p>
        <div
          role="progressbar"
          aria-label={t('progress.undoHeading')}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
        >
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        </div>
        <p className="m-0">{t('progress.undoingBody')}</p>
        <a
          href={`/${locale}/suite/admin/users`}
          className={`${buttonClasses({ variant: 'secondary', size: 'md' })} self-start`}
        >
          {t('progress.backToUsers')}
        </a>
      </section>
    );
  }
  const counts = record.reviewCounts;
  const planned = Math.max(1, count(counts, 'new') + count(counts, 'existing'));
  const done = Math.min(record.rowsDone, planned);
  const phase = runningPhase(record.status);
  const order = ['checking', 'importing', 'inviting'] as const;
  const at = order.indexOf(phase);
  const hold = record.options?.invitations === 'hold';
  const percent = Math.round((done / planned) * 100);
  return (
    <section
      aria-labelledby="progress-heading"
      className="flex flex-col gap-4"
      data-testid="import-progress"
    >
      <h1 id="progress-heading" className="m-0 text-2xl font-bold">
        {t('progress.heading')}
      </h1>
      <p className="m-0 text-sm text-text-muted">
        {t('progress.startedBy', {
          name: isolate(record.fileName),
          date: started,
          person: isolate(person),
        })}
      </p>
      <Card>
        <p className="mb-1 mt-0 flex flex-wrap justify-between gap-2 font-medium">
          <span>{t('progress.phases.importing')}</span>
          <span data-testid="import-progress-count">
            {t('progress.phaseCounts', { done, total: planned })}
          </span>
        </p>
        <div
          role="progressbar"
          aria-label={t('progress.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={t('progress.phaseCounts', { done, total: planned })}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
        >
          <div className="h-full bg-primary" style={{ inlineSize: `${String(percent)}%` }} />
        </div>
        <ol className="mb-0 mt-4 flex flex-col gap-2 ps-5">
          {order.map((step, i) => {
            const state =
              step === 'inviting' && hold
                ? t('progress.phaseState.skipped')
                : i < at
                  ? t('progress.phaseState.done')
                  : i === at
                    ? t('progress.phaseState.current')
                    : step === 'inviting'
                      ? t('progress.phaseState.waiting')
                      : '';
            return (
              <li key={step} aria-current={i === at ? 'step' : undefined}>
                <span className={i === at ? 'font-semibold' : undefined}>
                  {t(`progress.phases.${step}`)}
                </span>
                {state ? <span className="text-text-muted"> · {state}</span> : null}
                {step === 'importing' && i === at ? (
                  <span className="text-text-muted">
                    {' '}
                    · {t('progress.phaseCounts', { done, total: planned })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Card>
      {record.stopRequestedAt ? <Alert tone="info">{t('progress.stopRequested')}</Alert> : null}
      <p className="m-0">{t('progress.leaveNote')}</p>
      <p className="m-0 text-sm text-text-muted">{t('progress.oneAtATime')}</p>
      <div className="flex flex-wrap items-start gap-3">
        <a
          href={`/${locale}/suite/admin/users`}
          className={buttonClasses({ variant: 'secondary', size: 'md' })}
        >
          {t('progress.backToUsers')}
        </a>
        {record.mine && !record.stopRequestedAt ? (
          <StopImportButton
            importId={record.id}
            labels={{
              ...flatten(t.raw('progress')),
              stopBody: t('progress.stopBody', { count: done }),
            }}
            errors={await profileErrorTexts(locale)}
          />
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// The result (and the states without a run: refused, cancelled, expired)
// ---------------------------------------------------------------------------------------------------

const REFUSED = new Set([
  'FILE_TYPE',
  'FILE_TOO_LARGE',
  'FILE_TOO_MANY_ROWS',
  'FILE_INFECTED',
  'FILE_ENCODING',
  'FILE_EMPTY',
  'FILE_PROTECTED',
  'FILE_MACROS',
  'FILE_TOO_MANY_COLUMNS',
  'FILE_TOO_MANY_SHEETS',
  'FILE_UNREADABLE',
  'FILE_SCAN_FAILED',
  'FILE_DELETED',
  'SYSTEM_FAULT',
]);

export async function resultView(
  locale: AppLocale,
  view: UserImportView,
  dates: DisplayDateFormatter,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const format = await getFormatter({ locale });
  const { record } = view;
  const upload = (
    <a href={base(locale)} className={buttonClasses({ variant: 'primary', size: 'md' })}>
      {t('fileStates.chooseAnother')}
    </a>
  );
  if (record.status === 'rejected' || (record.status === 'failed' && record.confirmedAt === null)) {
    const failure = record.failureCode ?? '';
    const code = REFUSED.has(failure) ? failure : 'FILE_UNREADABLE';
    return (
      <>
        <h1 className="m-0 text-2xl font-bold">{t('title')}</h1>
        <Card
          title={t(`fileStates.refused.${code}.title` as 'fileStates.refused.FILE_TYPE.title')}
          data-testid="import-refused"
        >
          <p className="mt-0">
            {t(`fileStates.refused.${code}.body` as 'fileStates.refused.FILE_TOO_MANY_ROWS.body', {
              name: isolate(record.fileName),
              rows: largestSheet(record.sheets),
            })}
          </p>
          {upload}
        </Card>
      </>
    );
  }
  if (record.status === 'cancelled' || record.status === 'expired') {
    const cancelled = record.status === 'cancelled';
    // Expired while still waiting for its file (integration review M1): the cut upload's words.
    const uploadCut = record.status === 'expired' && record.failureCode === 'UPLOAD_NOT_FINISHED';
    const title = cancelled
      ? t('result.cancelledTitle')
      : uploadCut
        ? t('fileStates.uploadCut.title')
        : t('review.expired.title');
    const body = cancelled
      ? t('result.cancelledBody')
      : uploadCut
        ? t('fileStates.uploadCut.body')
        : t('review.expired.body');
    return (
      <>
        <h1 className="m-0 text-2xl font-bold">{t('title')}</h1>
        <Card title={title} data-testid={`import-${record.status}`}>
          <p className="mt-0">{body}</p>
          <a href={base(locale)} className={buttonClasses({ variant: 'primary', size: 'md' })}>
            {t('result.uploadAgain')}
          </a>
        </Card>
      </>
    );
  }

  const counts = record.resultCounts;
  const person = await importer(locale, view);
  const ended = dates.dateTime(record.undoneAt ?? record.finishedAt ?? record.updatedAt);
  const failed = count(counts, 'failed');
  const skipped = count(counts, 'skipped');
  const warned = count(counts, 'warned');
  // An undo that stopped before finishing (security review L1) leaves the import `failed` with its code.
  const undoStopped =
    record.status === 'failed' &&
    (record.failureCode === 'UNDO_NOT_ALLOWED' || record.failureCode === 'UNDO_FAILED');
  const heading =
    record.status === 'finished'
      ? t('result.finished')
      : record.status === 'stopped'
        ? t('result.stopped')
        : record.status === 'undone'
          ? t('result.undone')
          : undoStopped
            ? t('result.undoStopped')
            : t('result.failed');
  const summary =
    record.status === 'undone'
      ? t('result.undoneBody')
      : record.status === 'stopped'
        ? t('result.stoppedBody')
        : record.status === 'failed'
          ? record.failureCode === 'IMPORTER_NOT_ALLOWED'
            ? t('result.failedImporter')
            : record.failureCode === 'UNDO_NOT_ALLOWED'
              ? t('result.undoNotAllowed')
              : record.failureCode === 'UNDO_FAILED'
                ? t('result.undoFailedSystem')
                : t('result.failedSystem')
          : failed > 0
            ? t('result.someFailed', { count: failed })
            : t('result.allImported');
  const undone = undoSummary(counts);
  const undoneSentences: string[] = [];
  if (undone) {
    undoneSentences.push(
      t('result.undoCounts', {
        removed: undone.removed,
        kept: undone.kept,
        restored: undone.restored,
        changed: undone.changed,
      }),
    );
    if (undone.privileged > 0) {
      undoneSentences.push(t('result.undoKeptPrivileged', { count: undone.privileged }));
    }
    if (undone.errors > 0)
      undoneSentences.push(t('result.undoKeptError', { count: undone.errors }));
  }
  const deadline = undoDeadline(record.finishedAt);
  const errors = await fileActionErrorTexts(locale);
  const codes = await refusalCodes(locale);
  const sendHold = record.options?.invitations === 'hold';
  const invitations = record.invitations;
  const reasons = codeCounts(counts, 'failedCodes');
  const reportRows = failed + skipped + warned;

  let report: ReactNode;
  if (!record.mine) {
    report = <p className="m-0">{t('result.reportNotYours')}</p>;
  } else if (record.dataPurgedAt !== null) {
    report = <p className="m-0">{t('result.reportDeleted')}</p>;
  } else if (record.reportFileId === null) {
    report = (
      <p className="m-0" data-testid="result-report-missing">
        {reportRows === 0
          ? t('result.noReport')
          : record.reportCode === 'IMPORTER_NOT_ALLOWED'
            ? t('result.reportNotMadeImporter')
            : record.reportCode === 'REPORT_FAILED'
              ? t('result.reportFailed')
              : t('result.reportDeleted')}
      </p>
    );
  } else {
    report = (
      <>
        <p className="mt-0">{t('result.reportIntro', { failed, skipped, warned })}</p>
        <p>{t('result.reportFix')}</p>
        <ReportDownloadButton
          importId={record.id}
          which="report"
          label={t('result.downloadReport')}
          workingLabel={t('progress.working')}
          codes={codes}
          errors={errors}
          variant="primary"
        />
        {deadline ? (
          <p className="mb-0 mt-3 text-sm text-text-muted">
            {t('result.reportAvailable', { date: dates.date(deadline) })}
          </p>
        ) : null}
      </>
    );
  }

  const undoSentences: string[] = [];
  if (view.undo) {
    const removable = Math.max(0, view.undo.added - view.undo.accepted);
    undoSentences.push(t('undo.removes', { count: removable }));
    if (view.undo.accepted > 0) undoSentences.push(t('undo.keeps', { count: view.undo.accepted }));
    undoSentences.push(
      view.undo.updated > 0
        ? t('undo.restores', { count: view.undo.updated })
        : t('undo.noUpdates'),
    );
    undoSentences.push(t('undo.referenced'), t('undo.audit'));
    if (deadline) undoSentences.push(t('undo.after', { date: dates.date(deadline) }));
  }

  return (
    <section
      aria-labelledby="result-heading"
      className="flex flex-col gap-5"
      data-testid="import-result"
    >
      <div>
        <h1 id="result-heading" className="m-0 text-2xl font-bold">
          {heading}
        </h1>
        <p className="mb-0 mt-1 text-sm text-text-muted">
          {t('result.endedBy', {
            name: isolate(record.fileName),
            date: ended,
            person: isolate(person),
          })}
        </p>
      </div>
      <div role="status">
        <Alert tone={record.status === 'finished' ? 'success' : 'warning'} role="none">
          {summary}
        </Alert>
      </div>
      {undoneSentences.length > 0 ? (
        <ul className="m-0 flex flex-col gap-1 ps-5" data-testid="result-undo-counts">
          {undoneSentences.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="result-counts">
        <h2 id="result-counts" className="mb-3 mt-0 text-lg font-semibold">
          {t('result.countsHeading')}
        </h2>
        <dl
          className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="result-counts"
        >
          <div className="rounded-lg border border-border bg-surface p-4">
            <dd className="m-0 text-2xl font-bold" data-testid="result-added">
              {format.number(count(counts, 'added'), 'integer')}
            </dd>
            <dt className="font-medium">{t('result.added')}</dt>
            {count(counts, 'addedWithWarnings') > 0 ? (
              <dd className="m-0 text-sm text-text-muted">
                {t('result.addedWarnings', { count: count(counts, 'addedWithWarnings') })}
              </dd>
            ) : null}
          </div>
          {count(counts, 'added') > 0 && record.status !== 'undone' ? (
            <div
              className="rounded-lg border border-border bg-surface p-4"
              data-testid="result-invitations"
            >
              {sendHold || invitations.held > 0 ? (
                <>
                  <dd className="m-0 text-2xl font-bold">
                    {format.number(invitations.held, 'integer')}
                  </dd>
                  <dt className="font-medium">{t('result.invitationsHeld')}</dt>
                  <dd className="m-0 text-sm text-text-muted">{t('result.invitationsHeldHint')}</dd>
                  {record.mine && invitations.held > 0 ? (
                    <dd className="m-0 mt-3">
                      <SendInvitationsButton
                        importId={record.id}
                        label={t('result.sendInvitations', { count: invitations.held })}
                        workingLabel={t('result.sending')}
                        doneText={t('result.sendDone', { count: invitations.held })}
                        nothingText={codes.NOTHING_TO_SEND ?? ''}
                        notAllowedText={codes.SEND_NOT_ALLOWED ?? ''}
                        errors={errors}
                        testId="result-send-invitations"
                      />
                    </dd>
                  ) : null}
                </>
              ) : (
                <>
                  <dd className="m-0 text-2xl font-bold">
                    {format.number(invitations.sent + invitations.scheduled, 'integer')}
                  </dd>
                  <dt className="font-medium">{t('result.invitationsSent')}</dt>
                  <dd className="m-0 text-sm text-text-muted">
                    {invitations.scheduled > 0
                      ? t('result.invitationsProgress', { sent: invitations.sent })
                      : t('result.invitationsAllSent')}
                  </dd>
                </>
              )}
            </div>
          ) : null}
          <div className="rounded-lg border border-border bg-surface p-4">
            <dd className="m-0 text-2xl font-bold">
              {format.number(count(counts, 'updated'), 'integer')}
            </dd>
            <dt className="font-medium">{t('result.updated')}</dt>
            {record.options?.existing === 'skip' ? (
              <dd className="m-0 text-sm text-text-muted">{t('result.updatedSkip')}</dd>
            ) : null}
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <dd className="m-0 text-2xl font-bold">{format.number(skipped, 'integer')}</dd>
            <dt className="font-medium">{t('result.skipped')}</dt>
            <dd className="m-0 text-sm text-text-muted">
              {t('result.skippedHint', {
                existing: count(counts, 'skippedExisting'),
                other: Math.max(0, skipped - count(counts, 'skippedExisting')),
              })}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <dd className="m-0 text-2xl font-bold" data-testid="result-failed">
              {format.number(failed, 'integer')}
            </dd>
            <dt className="font-medium">{t('result.failedCount')}</dt>
            <dd className="m-0 text-sm text-text-muted">{t('result.failedHint')}</dd>
          </div>
        </dl>
      </section>

      <Card title={t('result.reportHeading')} data-testid="result-report">
        {report}
        {reasons.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-start">
              <caption className="mb-2 text-start font-medium">
                {t('result.reasonsCaption')}
              </caption>
              <thead className="bg-surface-sunken text-sm">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start">
                    {t('result.reasonsColumns.reason')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">
                    {t('result.reasonsColumns.rows')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {reasons.map((reason) => (
                  <tr key={reason.code} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-start font-medium">
                      {t(`codes.${reason.code}` as 'codes.EMAIL_INVALID')}
                    </th>
                    <td className="px-3 py-2">{format.number(reason.rows, 'integer')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <section aria-labelledby="result-next">
        <h2 id="result-next" className="mb-2 mt-0 text-lg font-semibold">
          {t('result.nextHeading')}
        </h2>
        <ul className="m-0 flex flex-col gap-2 ps-5">
          {count(counts, 'added') > 0 && record.status !== 'undone' ? (
            <li>
              <a href={`/${locale}/suite/admin/users?tab=invited`} className="underline">
                {t('result.viewInvited')}
              </a>
            </li>
          ) : null}
          <li>
            <a href={base(locale)} className="underline">
              {t('result.importAnother')}
            </a>{' '}
            {t('result.importAnotherHint')}
          </li>
          {record.status !== 'undone' ? <li>{t('result.privilegedHint')}</li> : null}
          {mayUndo(record) && deadline ? (
            <li>{t('result.undoAvailable', { date: dates.date(deadline) })}</li>
          ) : null}
        </ul>
      </section>
      {mayUndo(record) && view.undo ? (
        <UndoImportDialog
          importId={record.id}
          sentences={undoSentences}
          labels={{
            ...flatten(t.raw('undo')),
            title: t('undo.title', { name: isolate(record.fileName) }),
            undoAction: t('result.undoAction'),
          }}
          codes={codes}
          errors={errors}
        />
      ) : null}
    </section>
  );
}
