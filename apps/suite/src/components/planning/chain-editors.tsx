'use client';
import { searchPlanApproversAction } from '@jadarat/tms/actions/planning';
import { Badge, Button, Icon, TextField } from '@jadarat/ui';
import { useEffect, useState } from 'react';
import { type MemberChoice, type StepDraft, stepKey } from '../../lib/planning-chain';
import { localName } from '../../lib/planning-view';
import { SelectField } from '../select-field';

/** At least this many characters before the server is asked (platform-db MEMBER_SEARCH.minLength). */
const SEARCH_MIN_LENGTH = 2;

export interface ApprovalChainEditorProps {
  readonly locale: 'ar' | 'en';
  readonly steps: readonly StepDraft[];
  readonly onChange: (steps: StepDraft[]) => void;
  /** Names of the active members already named in the chain, by person id (the rest is searched). */
  readonly names: Readonly<Record<string, string>>;
  /** Named approvers who are no longer active members (their names, by person id). */
  readonly inactive: Readonly<Record<string, string>>;
  /** Field errors by path (`steps.N.field`). */
  readonly errors: Readonly<Record<string, string>>;
  readonly disabled: boolean;
  readonly t: (key: string, values?: Readonly<Record<string, string | number>>) => string;
  readonly maxSteps: number;
}

/**
 * The approval chain (business flow A3/B4; FR-WFL-01/02 R1 part): ordered steps — the built-in Department
 * Heads step (every head confirms their own lines at the same time; at most one) and named person steps
 * (BR-PLN-g: a person approves one step only). Reorder with the arrow buttons; keyboard and screen-reader
 * friendly (no drag and drop). Approvers are found by name on the server (C-M3: no capped list of every
 * member).
 */
export function ApprovalChainEditor(props: ApprovalChainEditorProps) {
  const { steps, t } = props;
  const set = (index: number, change: Partial<StepDraft>) => {
    props.onChange(steps.map((step, i) => (i === index ? { ...step, ...change } : step)));
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...steps];
    const [step] = next.splice(index, 1);
    if (!step) return;
    next.splice(index + by, 0, step);
    props.onChange(next);
  };
  const hasHeadsStep = steps.some((step) => step.kind === 'department_heads');

  return (
    <div className="flex flex-col gap-4" data-testid="approval-chain">
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {steps.map((step, index) => {
          const number = index + 1;
          const base = `chain-${step.key}`;
          const error = (field: string) => props.errors[`steps.${String(index)}.${field}`];
          const inactiveName = step.approverPersonId
            ? props.inactive[step.approverPersonId]
            : undefined;
          return (
            <li
              key={step.key}
              className="rounded-2xl border border-border p-4"
              data-testid="chain-step"
              aria-label={t('setup.approvals.stepLabel', { number })}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="grid size-7 place-items-center rounded-full bg-primary-subtle text-sm font-semibold text-primary-text"
                  >
                    {number}
                  </span>
                  <span className="font-semibold">
                    {t('setup.approvals.stepLabel', { number })}
                  </span>
                  <Badge tone={step.kind === 'department_heads' ? 'info' : 'neutral'}>
                    {t(`setup.approvals.kinds.${step.kind}`)}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      move(index, -1);
                    }}
                    disabled={props.disabled || index === 0}
                    aria-label={t('setup.approvals.moveUp', { number })}
                  >
                    <Icon name="chevron-down" className="rotate-180" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      move(index, 1);
                    }}
                    disabled={props.disabled || index === steps.length - 1}
                    aria-label={t('setup.approvals.moveDown', { number })}
                  >
                    <Icon name="chevron-down" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      props.onChange(steps.filter((_, i) => i !== index));
                    }}
                    disabled={props.disabled || steps.length === 1}
                    aria-label={t('setup.approvals.removeStep', { number })}
                    data-testid="chain-step-remove"
                  >
                    <Icon name="trash" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField
                  id={`${base}-kind`}
                  label={t('setup.approvals.kind')}
                  value={step.kind}
                  onChange={(event) => {
                    const kind =
                      event.target.value === 'department_heads' ? 'department_heads' : 'person';
                    set(index, {
                      kind,
                      approverPersonId: kind === 'person' ? step.approverPersonId : '',
                    });
                  }}
                  error={error('kind')}
                  disabled={props.disabled}
                >
                  <option value="person">{t('setup.approvals.kinds.person')}</option>
                  <option
                    value="department_heads"
                    disabled={hasHeadsStep && step.kind !== 'department_heads'}
                  >
                    {t('setup.approvals.kinds.department_heads')}
                  </option>
                </SelectField>
                {step.kind === 'person' ? (
                  <ApproverPicker
                    id={`${base}-approver`}
                    locale={props.locale}
                    value={step.approverPersonId}
                    currentName={
                      step.approverPersonId
                        ? (inactiveName ?? props.names[step.approverPersonId])
                        : undefined
                    }
                    error={
                      error('approverPersonId') ??
                      (inactiveName
                        ? t('setup.approvals.approverInactive', { name: inactiveName })
                        : undefined)
                    }
                    disabled={props.disabled}
                    t={t}
                    onPick={(personId) => {
                      set(index, { approverPersonId: personId });
                    }}
                  />
                ) : (
                  <p className="m-0 self-end text-sm text-text-muted">
                    {t('setup.approvals.headsHint')}
                  </p>
                )}
                <TextField
                  id={`${base}-name-en`}
                  label={t('setup.approvals.nameEn')}
                  value={step.nameEn}
                  onChange={(event) => {
                    set(index, { nameEn: event.target.value });
                  }}
                  maxLength={80}
                  dir="ltr"
                  lang="en"
                  autoComplete="off"
                  error={error('nameEn')}
                  disabled={props.disabled}
                />
                <TextField
                  id={`${base}-name-ar`}
                  label={t('setup.approvals.nameAr')}
                  value={step.nameAr}
                  onChange={(event) => {
                    set(index, { nameAr: event.target.value });
                  }}
                  maxLength={80}
                  dir="rtl"
                  lang="ar"
                  autoComplete="off"
                  error={error('nameAr')}
                  disabled={props.disabled}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            props.onChange([
              ...steps,
              { key: stepKey(), kind: 'person', nameAr: '', nameEn: '', approverPersonId: '' },
            ]);
          }}
          disabled={props.disabled || steps.length >= props.maxSteps}
          data-testid="chain-add-step"
        >
          <Icon name="plus" />
          {t('setup.approvals.addStep')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Finds a person by name (server search, at least two letters, up to 50 active members) and picks one from
 * the matches; the chosen person stays in the list while searching again.
 */
function ApproverPicker(props: {
  readonly id: string;
  readonly locale: 'ar' | 'en';
  readonly value: string;
  readonly currentName: string | undefined;
  readonly error: string | undefined;
  readonly disabled: boolean;
  readonly t: (key: string, values?: Readonly<Record<string, string | number>>) => string;
  readonly onPick: (personId: string) => void;
}) {
  const { t } = props;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly MemberChoice[] | null>(null);
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({});
  const text = query.trim();

  useEffect(() => {
    if ([...text].length < SEARCH_MIN_LENGTH) {
      setResults(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void searchPlanApproversAction({ q: text }).then((result) => {
        if (!current) return;
        setResults(
          result.ok
            ? result.value.members.map((m) => ({
                personId: m.personId,
                name: localName(props.locale, m.name),
              }))
            : [],
        );
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, props.locale]);

  const chosenName = props.value ? (props.currentName ?? picked[props.value]) : undefined;
  const options = (results ?? []).filter((m) => m.personId !== props.value);
  const hint =
    results === null
      ? t('setup.approvals.searchHint')
      : results.length === 0
        ? t('setup.approvals.noMatch')
        : undefined;

  return (
    <div className="flex flex-col gap-2">
      <TextField
        id={`${props.id}-search`}
        type="search"
        label={t('setup.approvals.search')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        hint={hint}
        autoComplete="off"
        maxLength={100}
        disabled={props.disabled}
        data-testid="chain-step-approver-search"
      />
      <SelectField
        id={props.id}
        label={t('setup.approvals.approver')}
        value={props.value}
        onChange={(event) => {
          const personId = event.target.value;
          const found = options.find((m) => m.personId === personId);
          if (found) setPicked((names) => ({ ...names, [found.personId]: found.name }));
          props.onPick(personId);
        }}
        error={props.error}
        disabled={props.disabled}
        data-testid="chain-step-approver"
      >
        <option value="">{t('setup.approvals.approverPlaceholder')}</option>
        {props.value ? <option value={props.value}>{chosenName ?? props.value}</option> : null}
        {options.map((member) => (
          <option key={member.personId} value={member.personId}>
            {member.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

export interface ReminderDaysEditorProps {
  readonly days: readonly string[];
  readonly onChange: (days: string[]) => void;
  readonly error: string | undefined;
  readonly disabled: boolean;
  readonly t: (key: string, values?: Readonly<Record<string, string | number>>) => string;
  readonly maxReminders: number;
}

/** Reminder days before the deadline (business flow A3/B4): up to five, 1–90, each once. */
export function ReminderDaysEditor(props: ReminderDaysEditorProps) {
  const { t } = props;
  return (
    <div className="flex flex-col gap-3" data-testid="reminder-days">
      {props.days.length === 0 ? (
        <p className="m-0 text-sm text-text-muted">{t('setup.reminders.none')}</p>
      ) : null}
      <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
        {props.days.map((day, index) => {
          const id = `reminder-${String(index)}`;
          return (
            <li key={id} className="flex items-end gap-1">
              <div className="flex flex-col gap-1">
                <label htmlFor={id} className="text-sm font-medium">
                  {t('setup.reminders.dayLabel')}
                </label>
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={90}
                  value={day}
                  onChange={(event) => {
                    props.onChange(
                      props.days.map((d, i) => (i === index ? event.target.value : d)),
                    );
                  }}
                  disabled={props.disabled}
                  aria-invalid={props.error ? true : undefined}
                  aria-describedby={props.error ? 'reminders-error' : undefined}
                  className="min-h-9 w-28 rounded-full border border-border-strong bg-surface px-4 text-sm shadow-1 pointer-coarse:min-h-11"
                  data-testid="reminder-day"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  props.onChange(props.days.filter((_, i) => i !== index));
                }}
                disabled={props.disabled}
                aria-label={t('setup.reminders.remove', { days: day })}
              >
                <Icon name="trash" />
              </Button>
            </li>
          );
        })}
      </ul>
      {props.error ? (
        <p id="reminders-error" className="m-0 text-sm font-medium text-danger">
          {props.error}
        </p>
      ) : null}
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            props.onChange([...props.days, '']);
          }}
          disabled={props.disabled || props.days.length >= props.maxReminders}
          data-testid="reminder-add"
        >
          <Icon name="plus" />
          {t('setup.reminders.add')}
        </Button>
      </div>
    </div>
  );
}
