'use client';
import { Badge, Button, Icon, TextField } from '@jadarat/ui';
import { type MemberChoice, type StepDraft, stepKey } from '../../lib/planning-chain';
import { SelectField } from '../select-field';

export interface ApprovalChainEditorProps {
  readonly steps: readonly StepDraft[];
  readonly onChange: (steps: StepDraft[]) => void;
  readonly members: readonly MemberChoice[];
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
 * friendly (no drag and drop).
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
                <div className="flex items-center gap-1">
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
                  <SelectField
                    id={`${base}-approver`}
                    label={t('setup.approvals.approver')}
                    value={step.approverPersonId}
                    onChange={(event) => {
                      set(index, { approverPersonId: event.target.value });
                    }}
                    error={
                      error('approverPersonId') ??
                      (inactiveName
                        ? t('setup.approvals.approverInactive', { name: inactiveName })
                        : undefined)
                    }
                    hint={props.members.length === 0 ? t('setup.approvals.noMembers') : undefined}
                    disabled={props.disabled}
                    data-testid="chain-step-approver"
                  >
                    <option value="">{t('setup.approvals.approverPlaceholder')}</option>
                    {inactiveName && step.approverPersonId ? (
                      <option value={step.approverPersonId}>{inactiveName}</option>
                    ) : null}
                    {props.members.map((member) => (
                      <option key={member.personId} value={member.personId}>
                        {member.name}
                      </option>
                    ))}
                  </SelectField>
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
