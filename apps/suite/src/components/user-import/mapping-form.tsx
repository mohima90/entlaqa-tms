'use client';
import { Alert, Badge, Button, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { chooseUserImportMappingAction } from '../../actions/user-import';
import { fillText } from '../../lib/fill-text';
import { type ErrorTexts, errorText } from '../auth/error-text';

export interface MappingSheet {
  readonly index: number;
  /** «الموظفين (4,862 صفًا)», or why it cannot be imported. */
  readonly label: string;
  readonly usable: boolean;
}

export type MappingRecognition =
  | { readonly kind: 'recognized'; readonly field: string }
  | { readonly kind: 'suggested'; readonly field: string; readonly because: string }
  | { readonly kind: 'never'; readonly reason: string }
  | { readonly kind: 'unknown' };

export interface MappingColumn {
  readonly sheetIndex: number;
  readonly index: number;
  readonly header: string;
  readonly samples: readonly string[];
  readonly recognition: MappingRecognition;
}

export interface MappingFormProps {
  readonly importId: string;
  readonly sheets: readonly MappingSheet[];
  readonly initialSheet: number;
  readonly columns: readonly MappingColumn[];
  /** The fields in the design's order with their labels. */
  readonly fields: readonly { readonly field: string; readonly label: string }[];
  readonly required: readonly string[];
  /** The mapping chosen before (back from the review), by column index. */
  readonly chosen: Readonly<Record<string, string>> | null;
  readonly chosenSheet: number | null;
  /** Texts of namespace `userImport.mapping` (raw: `{column}`, `{field}`, … are filled in here). */
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly backHref: string;
  readonly locale: string;
}

type Choice = Readonly<Record<number, { readonly field: string; readonly confirmed: boolean }>>;

function initialChoice(
  columns: readonly MappingColumn[],
  chosen: Readonly<Record<string, string>> | null,
): Choice {
  const choice: Record<number, { field: string; confirmed: boolean }> = {};
  for (const column of columns) {
    if (chosen) {
      choice[column.index] = { field: chosen[String(column.index)] ?? '', confirmed: true };
    } else if (column.recognition.kind === 'recognized') {
      choice[column.index] = { field: column.recognition.field, confirmed: true };
    } else if (column.recognition.kind === 'suggested') {
      choice[column.index] = { field: column.recognition.field, confirmed: false };
    } else {
      choice[column.index] = { field: '', confirmed: true };
    }
  }
  return choice;
}

/**
 * Step 2 «مطابقة الأعمدة» (approved screen 5): the file's columns with sample values and the field each is
 * imported into — recognized automatically, suggested by values (to confirm), never imported, or ignored.
 * Every select is labelled by its column; two columns never map to the same field; the required fields
 * must be mapped and every suggestion confirmed or changed before «التالي».
 */
export function MappingForm(props: MappingFormProps) {
  const { labels, fields } = props;
  const text = (key: string, values: Readonly<Record<string, string | number>> = {}) =>
    fillText(labels[key] ?? key, values, props.locale);
  const fieldLabel = (field: string) => fields.find((f) => f.field === field)?.label ?? field;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheet, setSheet] = useState(props.chosenSheet ?? props.initialSheet);
  const sheetColumns = useMemo(
    () => props.columns.filter((c) => c.sheetIndex === sheet),
    [props.columns, sheet],
  );
  const [choices, setChoices] = useState<Readonly<Record<number, Choice>>>(() => ({
    [sheet]: initialChoice(
      props.columns.filter((c) => c.sheetIndex === sheet),
      sheet === props.chosenSheet ? props.chosen : null,
    ),
  }));
  const choice = choices[sheet] ?? initialChoice(sheetColumns, null);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const used = new Map<string, number>();
  for (const [index, c] of Object.entries(choice)) {
    if (c.field) used.set(c.field, Number(index));
  }
  const missing = props.required.filter((field) => !used.has(field));
  const unconfirmed = sheetColumns.filter((c) => choice[c.index]?.confirmed === false);
  const recognized = sheetColumns.filter((c) => c.recognition.kind === 'recognized').length;
  const ready = missing.length === 0 && unconfirmed.length === 0;
  const optionalMissing = fields.filter(
    (f) => !props.required.includes(f.field) && !used.has(f.field),
  );

  const update = (index: number, field: string) => {
    setChoices((all) => ({ ...all, [sheet]: { ...choice, [index]: { field, confirmed: true } } }));
  };
  const changeSheet = (next: number) => {
    setSheet(next);
    setChoices((all) =>
      all[next]
        ? all
        : {
            ...all,
            [next]: initialChoice(
              props.columns.filter((c) => c.sheetIndex === next),
              null,
            ),
          },
    );
  };

  const submit = () => {
    setSubmitted(true);
    setFailure(null);
    if (!ready) return;
    const mapping: Record<string, string> = {};
    for (const [index, c] of Object.entries(choice)) if (c.field) mapping[index] = c.field;
    startTransition(async () => {
      const result = await chooseUserImportMappingAction({
        importId: props.importId,
        sheetIndex: sheet,
        mapping: mapping as never,
      });
      if (result.ok) {
        router.refresh();
        return;
      }
      const codes = (result.error.fieldErrors ?? []).map((e) => {
        const field = e.path.startsWith('mapping.') ? e.path.slice('mapping.'.length) : '';
        return text(`errors.${e.code}`, { field: fieldLabel(field) });
      });
      setFailure(codes.length > 0 ? codes.join(' ') : errorText(result.error, props.errors));
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="mapping-form">
      <p className="m-0">
        {text('intro', { recognized, total: sheetColumns.length })}
        {unconfirmed.length > 0 ? ` ${text('suggestionsIntro')}` : ''}
      </p>
      {props.sheets.length > 1 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="import-sheet" className="font-medium">
            {text('sheet')}
          </label>
          <select
            id="import-sheet"
            value={sheet}
            onChange={(event) => {
              changeSheet(Number(event.target.value));
            }}
            className="select-chevron min-h-11 rounded-full border border-border-strong bg-surface ps-4 pe-10 text-sm text-text shadow-1 sm:w-96"
          >
            {props.sheets.map((s) => (
              <option key={s.index} value={s.index} disabled={!s.usable}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <section aria-labelledby="mapping-required" className="rounded-lg border border-border p-4">
        <h2 id="mapping-required" className="m-0 text-base font-semibold">
          {text('required')}
        </h2>
        <ul className="m-0 mt-2 flex flex-col gap-1 ps-5">
          {props.required.map((field) => {
            const at = used.get(field);
            const column = sheetColumns.find((c) => c.index === at);
            return (
              <li key={field}>
                {at === undefined || !column
                  ? text('requiredMissing', { field: fieldLabel(field) })
                  : text('requiredFound', {
                      field: fieldLabel(field),
                      column: column.header || text('noHeader'),
                    })}
              </li>
            );
          })}
        </ul>
      </section>

      {submitted && missing.length > 0 ? (
        <Alert tone="danger" data-testid="mapping-missing">
          {missing.map((field) => text('errors.MISSING', { field: fieldLabel(field) })).join(' ')}
        </Alert>
      ) : null}
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-start" data-testid="mapping-table">
          <caption className="sr-only">{text('caption')}</caption>
          <thead className="bg-surface-sunken text-sm">
            <tr>
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-start font-semibold">
                {text('columns.column')}
              </th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-start font-semibold">
                {text('columns.samples')}
              </th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-start font-semibold">
                {text('columns.target')}
              </th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-start font-semibold">
                {text('columns.state')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sheetColumns.map((column) => {
              const c = choice[column.index] ?? { field: '', confirmed: true };
              const header = column.header || text('noHeader');
              const id = `map-${String(sheet)}-${String(column.index)}`;
              const recognition = column.recognition;
              return (
                <tr key={column.index} className="border-t border-border align-top">
                  <th scope="row" className="min-w-32 px-4 py-3 text-start font-medium">
                    <bdi>{header}</bdi>
                  </th>
                  <td className="min-w-48 px-4 py-3 text-sm text-text-muted">
                    {recognition.kind === 'never'
                      ? text('never')
                      : column.samples.length > 0
                        ? column.samples.map((sample, i) => (
                            <span key={i}>
                              {i > 0 ? ' · ' : ''}
                              <bdi>{sample}</bdi>
                            </span>
                          ))
                        : text('noSamples')}
                  </td>
                  <td className="min-w-56 px-4 py-3">
                    {recognition.kind === 'never' ? (
                      <span>{text('never')}</span>
                    ) : (
                      <>
                        <label htmlFor={id} className="sr-only">
                          {text('selectLabel', { column: header })}
                        </label>
                        <select
                          id={id}
                          value={c.field}
                          onChange={(event) => {
                            update(column.index, event.target.value);
                          }}
                          className="select-chevron min-h-11 w-full min-w-48 rounded-full border border-border-strong bg-surface ps-4 pe-10 text-sm text-text shadow-1"
                          data-testid={`map-select-${String(column.index)}`}
                        >
                          <option value="">{text('ignore')}</option>
                          {fields.map((f) => (
                            <option
                              key={f.field}
                              value={f.field}
                              disabled={used.has(f.field) && used.get(f.field) !== column.index}
                            >
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </td>
                  <td className="min-w-40 px-4 py-3 text-sm">
                    {recognition.kind === 'never' ? (
                      <>
                        <Badge>{text('ignored')}</Badge>
                        <p className="mb-0 mt-1 text-text-muted">
                          {text(`neverReason.${recognition.reason}`)}
                        </p>
                      </>
                    ) : recognition.kind === 'suggested' && !c.confirmed ? (
                      <div className="flex flex-col gap-2">
                        <Badge tone="warning">{text('suggested')}</Badge>
                        <p className="m-0 text-text-muted">
                          {text(`suggestedBecause.${recognition.because}`, {
                            field: fieldLabel(recognition.field),
                          })}
                        </p>
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={() => {
                            update(column.index, c.field);
                          }}
                          data-testid={`confirm-suggestion-${String(column.index)}`}
                        >
                          {text('confirmSuggestion')}
                          <span className="sr-only">{` (${header})`}</span>
                        </Button>
                      </div>
                    ) : c.field === '' ? (
                      <Badge>{text('ignored')}</Badge>
                    ) : recognition.kind === 'recognized' && c.field === recognition.field ? (
                      <Badge tone="success">{text('recognized')}</Badge>
                    ) : recognition.kind === 'suggested' && c.field === recognition.field ? (
                      <Badge tone="success">{text('confirmed')}</Badge>
                    ) : (
                      <Badge tone="info">{text('chosen')}</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {optionalMissing.length > 0 ? (
        <p className="m-0 text-sm text-text-muted">
          {text('missingOptional', {
            fields: optionalMissing.map((f) => f.label).join(text('listSeparator')),
          })}
        </p>
      ) : null}
      <p className="m-0 text-sm text-text-muted">{text('rules')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <a href={props.backHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {text('back')}
        </a>
        <Button
          variant="primary"
          disabled={pending}
          aria-describedby={ready ? undefined : 'mapping-next-hint'}
          onClick={submit}
          data-testid="mapping-next"
        >
          {pending ? text('working') : text('next')}
        </Button>
        {ready ? null : (
          <p id="mapping-next-hint" className="m-0 text-sm text-text-muted">
            {text('nextHint')}
          </p>
        )}
      </div>
    </div>
  );
}
