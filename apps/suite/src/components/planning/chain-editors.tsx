'use client';
import { searchPlanApproversAction } from '@jadarat/tms/actions/planning';
import { Avatar, Button, FieldError, Icon, TextField, cn, fieldInputClasses } from '@jadarat/ui';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';
import {
  type MemberChoice,
  type StepDraft,
  parseReminderDays,
  stepKey,
} from '../../lib/planning-chain';
import { localName } from '../../lib/planning-view';

/** At least this many characters before the server is asked (platform-db MEMBER_SEARCH.minLength). */
const SEARCH_MIN_LENGTH = 2;

type T = (key: string, values?: Readonly<Record<string, string | number>>) => string;

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
  readonly t: T;
  readonly maxSteps: number;
}

const TOOL =
  'grid size-9 place-items-center rounded-full border border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:size-11';

/**
 * The approval chain as a numbered timeline (business flow A3/B4; FR-WFL-01/02 R1 part; redesign package 4):
 * ordered steps — the built-in Unit heads step (every head confirms their own lines at the same time; at most
 * one) and named person steps (BR-PLN-g: a person approves one step only). The step type is a two-choice
 * control; the approver one search field with its matches (C-M3: found by name on the server). Reorder with
 * Move up / Move down (WCAG 2.5.7); the drag handle is a pointer-only extra that does the same.
 */
export function ApprovalChainEditor(props: ApprovalChainEditorProps) {
  const { steps, t } = props;
  const [dragging, setDragging] = useState<number | null>(null);
  const set = (index: number, change: Partial<StepDraft>) => {
    props.onChange(steps.map((step, i) => (i === index ? { ...step, ...change } : step)));
  };
  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [step] = next.splice(from, 1);
    if (!step) return;
    next.splice(to, 0, step);
    props.onChange(next);
  };
  const hasHeadsStep = steps.some((step) => step.kind === 'department_heads');

  return (
    <div className="flex flex-col gap-3.5" data-testid="approval-chain">
      <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
        {steps.map((step, index) => {
          const number = index + 1;
          const base = `chain-${step.key}`;
          const error = (field: string) => props.errors[`steps.${String(index)}.${field}`];
          const inactiveName = step.approverPersonId
            ? props.inactive[step.approverPersonId]
            : undefined;
          const approverError =
            error('approverPersonId') ??
            (inactiveName
              ? t('setup.approvals.approverInactive', { name: inactiveName })
              : undefined);
          const title =
            (props.locale === 'ar' ? step.nameAr : step.nameEn).trim() ||
            t('setup.approvals.stepLabel', { number });
          return (
            <li
              key={step.key}
              className={cn(
                'relative',
                index < steps.length - 1 &&
                  'before:absolute before:-bottom-3.5 before:start-4 before:top-9 before:border-s-2 before:border-dashed before:border-border-strong md:before:start-[21px] md:before:top-[46px]',
                dragging === index && 'opacity-60',
              )}
              data-testid="chain-step"
            >
              {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- only a drop target of the pointer-only drag handle; Move up / Move down are the keyboard and screen-reader way (WCAG 2.5.7) */}
              <div
                className="grid grid-cols-[34px_minmax(0,1fr)] gap-2.5 md:grid-cols-[44px_minmax(0,1fr)] md:gap-3.5"
                onDragOver={(event) => {
                  if (dragging !== null) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== null) moveTo(dragging, index);
                  setDragging(null);
                }}
              >
                <span
                  aria-hidden="true"
                  className="relative z-[1] grid size-[34px] place-items-center rounded-full bg-brand-gradient text-sm font-bold text-on-brand md:size-11 md:text-base"
                >
                  {number}
                </span>
                <section
                  aria-label={t('setup.approvals.stepLabel', { number })}
                  className={cn(
                    'flex min-w-0 flex-col gap-3.5 rounded-[20px] border bg-surface p-3.5 md:px-4.5 md:py-4',
                    approverError || error('nameEn') || error('nameAr')
                      ? 'border-danger/50'
                      : 'border-border',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="min-w-0 flex-1 font-bold [overflow-wrap:anywhere]">
                      {title}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {props.disabled ? null : (
                        <span
                          aria-hidden="true"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            setDragging(index);
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                          }}
                          className="hidden h-9 w-7 cursor-grab place-items-center text-text-subtle pointer-fine:grid"
                        >
                          <Icon name="menu" className="size-4" />
                        </span>
                      )}
                      <button
                        type="button"
                        className={TOOL}
                        onClick={() => {
                          moveTo(index, index - 1);
                        }}
                        disabled={props.disabled || index === 0}
                        aria-label={t('setup.approvals.moveUp', { number })}
                      >
                        <Icon name="arrow-up" className="size-4" />
                      </button>
                      <button
                        type="button"
                        className={TOOL}
                        onClick={() => {
                          moveTo(index, index + 1);
                        }}
                        disabled={props.disabled || index === steps.length - 1}
                        aria-label={t('setup.approvals.moveDown', { number })}
                      >
                        <Icon name="arrow-down" className="size-4" />
                      </button>
                      <button
                        type="button"
                        className={TOOL}
                        onClick={() => {
                          props.onChange(steps.filter((_, i) => i !== index));
                        }}
                        disabled={props.disabled || steps.length === 1}
                        aria-label={t('setup.approvals.removeStep', { number })}
                        data-testid="chain-step-remove"
                      >
                        <Icon name="trash" className="size-4" />
                      </button>
                    </span>
                  </div>

                  <fieldset className="m-0 min-w-0 border-0 p-0">
                    <legend className="sr-only">{t('setup.approvals.kind')}</legend>
                    <div className="flex flex-wrap gap-1 rounded-full bg-surface-sunken p-1">
                      {(['department_heads', 'person'] as const).map((kind) => {
                        const id = `${base}-kind-${kind}`;
                        const unavailable =
                          kind === 'department_heads' && hasHeadsStep && step.kind !== kind;
                        return (
                          <label
                            key={kind}
                            htmlFor={id}
                            className={cn(
                              'relative inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring pointer-coarse:min-h-11 md:flex-none',
                              step.kind === kind
                                ? 'bg-surface text-text shadow-1'
                                : 'text-text-muted hover:text-text',
                              unavailable && 'cursor-not-allowed opacity-60 hover:text-text-muted',
                            )}
                          >
                            <input
                              id={id}
                              type="radio"
                              name={`${base}-kind`}
                              value={kind}
                              checked={step.kind === kind}
                              disabled={props.disabled || unavailable}
                              onChange={() => {
                                set(index, {
                                  kind,
                                  approverPersonId: kind === 'person' ? step.approverPersonId : '',
                                });
                              }}
                              className="sr-only"
                              data-testid={`chain-step-kind-${kind}`}
                            />
                            <Icon name={kind === 'person' ? 'user' : 'people'} className="size-4" />
                            {t(`setup.approvals.kinds.${kind}`)}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

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
                      error={approverError}
                      disabled={props.disabled}
                      t={t}
                      onPick={(personId) => {
                        set(index, { approverPersonId: personId });
                      }}
                    />
                  ) : (
                    <p className="m-0 flex items-start gap-2.5 rounded-xl bg-surface-sunken px-3 py-2.5 text-sm text-text-muted">
                      <Icon name="people" className="mt-0.5 size-4" />
                      <span>{t('setup.approvals.headsHint')}</span>
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TextField
                      id={`${base}-name-en`}
                      label={t('setup.approvals.nameEn')}
                      marker={t('setup.required')}
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
                      marker={t('setup.required')}
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
                </section>
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => {
          props.onChange([
            ...steps,
            { key: stepKey(), kind: 'person', nameAr: '', nameEn: '', approverPersonId: '' },
          ]);
        }}
        disabled={props.disabled || steps.length >= props.maxSteps}
        className="flex min-h-13.5 w-full items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-border-strong bg-transparent font-semibold text-primary-text hover:bg-primary-subtle disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="chain-add-step"
      >
        <Icon name="plus" className="size-4" />
        {t('setup.approvals.addStep')}
      </button>
    </div>
  );
}

/**
 * The approver of a person step (redesign package 4: one combobox instead of a search box plus a select):
 * the chosen person with «Edit»; otherwise a search field (at least two letters, server search of active
 * members) whose matches open as a list under it — ↑ ↓ move, ↵ picks, Esc closes.
 */
function ApproverPicker(props: {
  readonly id: string;
  readonly locale: 'ar' | 'en';
  readonly value: string;
  readonly currentName: string | undefined;
  readonly error: string | undefined;
  readonly disabled: boolean;
  readonly t: T;
  readonly onPick: (personId: string) => void;
}) {
  const { t } = props;
  const listId = useId();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  // The last answer and the text it answers (a newer text shows no stale matches).
  const [found, setFound] = useState<{
    readonly text: string;
    readonly members: readonly MemberChoice[];
  } | null>(null);
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({});
  const text = query.trim();
  const searching = text.length >= SEARCH_MIN_LENGTH;

  useEffect(() => {
    if (!searching) return;
    let current = true;
    const timer = setTimeout(() => {
      void searchPlanApproversAction({ q: text }).then((result) => {
        if (!current) return;
        setFound({
          text,
          members: result.ok
            ? result.value.members.map((m) => ({
                personId: m.personId,
                name: localName(props.locale, m.name),
              }))
            : [],
        });
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, searching, props.locale]);

  const results = !searching ? null : found?.text === text ? found.members : null;
  const options = (results ?? []).filter((m) => m.personId !== props.value);
  const open = !closed && options.length > 0;
  const chosenName = props.value ? (props.currentName ?? picked[props.value]) : undefined;
  const label = t('setup.approvals.approver');
  const errorId = `${props.id}-error`;
  const hintId = `${props.id}-hint`;

  const pick = (member: MemberChoice) => {
    setPicked((names) => ({ ...names, [member.personId]: member.name }));
    props.onPick(member.personId);
    setQuery('');
    setEditing(false);
  };

  if (props.value && !editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold" id={`${props.id}-label`}>
          {label}
        </span>
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-[14px] border bg-surface-sunken py-2 pe-2.5 ps-2',
            props.error ? 'border-danger' : 'border-border',
          )}
          data-testid="chain-step-approver"
        >
          <Avatar name={chosenName ?? '?'} size="sm" />
          <b className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
            {chosenName ?? props.value}
          </b>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(true);
              setClosed(false);
            }}
            disabled={props.disabled}
            aria-label={`${label}: ${chosenName ?? ''} — ${t('edit')}`}
            data-testid="chain-step-approver-change"
          >
            {t('edit')}
          </Button>
        </div>
        {props.error ? <FieldError id={errorId}>{props.error}</FieldError> : null}
      </div>
    );
  }

  const hint =
    results === null
      ? t('setup.approvals.searchHint')
      : results.length === 0
        ? t('setup.approvals.noMatch')
        : t('setup.approvals.searchHint');

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setClosed(false);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const member = options[active];
      if (member) pick(member);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setClosed(true);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={props.id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-3.5 grid place-items-center text-text-subtle">
          <Icon name="search" className="size-4" />
        </span>
        <input
          id={props.id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${String(active)}` : undefined}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={[hintId, props.error ? errorId : ''].filter(Boolean).join(' ')}
          placeholder={t('setup.approvals.search')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setClosed(false);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setClosed(true);
          }}
          onFocus={() => {
            setClosed(false);
          }}
          autoComplete="off"
          maxLength={100}
          disabled={props.disabled}
          className={cn(fieldInputClasses, 'ps-10', props.error && 'border-danger')}
          data-testid="chain-step-approver-search"
        />
        {open ? (
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute inset-x-0 top-[calc(100%+6px)] z-10 flex max-h-72 flex-col overflow-auto rounded-2xl border border-border bg-surface-raised p-1.5 shadow-4"
          >
            {options.map((member, index) => (
              <div
                key={member.personId}
                id={`${listId}-${String(index)}`}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(member);
                }}
                className={cn(
                  'flex min-h-12 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5',
                  index === active
                    ? 'bg-primary-subtle text-primary-text'
                    : 'hover:bg-surface-hover',
                )}
                data-testid="chain-step-approver-option"
              >
                <Avatar name={member.name} size="sm" tone={index === active ? 'brand' : 'soft'} />
                <span className="min-w-0 [overflow-wrap:anywhere]">{member.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <p id={hintId} className="m-0 text-[13.5px] text-text-muted">
        {hint}
      </p>
      {props.error ? <FieldError id={errorId}>{props.error}</FieldError> : null}
    </div>
  );
}

export interface ReminderDaysEditorProps {
  readonly locale: 'ar' | 'en';
  readonly days: readonly string[];
  readonly onChange: (days: string[]) => void;
  readonly error: string | undefined;
  readonly onError: (error: string | undefined) => void;
  readonly disabled: boolean;
  readonly t: T;
  readonly maxReminders: number;
}

/**
 * Reminder days before the deadline (business flow A3/B4; redesign package 4): chips «7 days before» with
 * ×, and «Add a reminder» with the number of days (1–90, each once, up to five) — checked when added.
 */
export function ReminderDaysEditor(props: ReminderDaysEditorProps) {
  const { t } = props;
  const [draft, setDraft] = useState('');

  const add = () => {
    if (props.days.length >= props.maxReminders) return;
    const parsed = parseReminderDays([...props.days, draft]);
    if (!parsed.ok) {
      props.onError(t(parsed.key));
      return;
    }
    props.onChange([...props.days, draft.trim()]);
    props.onError(undefined);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-4" data-testid="reminder-days">
      {props.days.length === 0 ? (
        <p className="m-0 text-text-muted">{t('setup.reminders.none')}</p>
      ) : (
        <ul
          className="m-0 flex list-none flex-wrap gap-2.5 p-0"
          aria-label={t('setup.reminders.title')}
        >
          {props.days.map((day, index) => {
            const value = Number(day);
            return (
              <li
                key={`${day}-${String(index)}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-primary/30 bg-primary-subtle pe-1 ps-3.5 font-semibold text-primary-text"
                data-testid="reminder-day"
              >
                <Icon name="bell" className="size-3.5" />
                {Number.isFinite(value) ? t('setup.reminders.chip', { days: value }) : day}
                <button
                  type="button"
                  onClick={() => {
                    props.onChange(props.days.filter((_, i) => i !== index));
                    props.onError(undefined);
                  }}
                  disabled={props.disabled}
                  aria-label={t('setup.reminders.remove', { days: day })}
                  className="grid size-9 place-items-center rounded-full text-primary-text hover:bg-primary/15 disabled:opacity-60"
                  data-testid="reminder-remove"
                >
                  <Icon name="close" className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2.5">
        <TextField
          id="reminder-new"
          type="number"
          inputMode="numeric"
          min={1}
          max={90}
          label={t('setup.reminders.dayLabel')}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            props.onError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          disabled={props.disabled}
          className="w-full sm:w-56"
          aria-describedby={props.error ? 'reminders-error' : undefined}
          aria-invalid={props.error ? true : undefined}
          data-testid="reminder-new"
        />
        <Button
          variant="secondary"
          onClick={add}
          disabled={props.disabled || props.days.length >= props.maxReminders}
          className="w-full sm:w-auto"
          data-testid="reminder-add"
        >
          <Icon name="plus" />
          {t('setup.reminders.add')}
        </Button>
      </div>
      {props.error ? <FieldError id="reminders-error">{props.error}</FieldError> : null}
    </div>
  );
}
