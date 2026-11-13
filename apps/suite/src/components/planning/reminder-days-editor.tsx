'use client';
import { Button, FieldError, Icon, TextField } from '@jadarat/ui';
import { useState } from 'react';
import { parseReminderDays } from '../../lib/planning-view';

type T = (key: string, values?: Readonly<Record<string, string | number>>) => string;

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
