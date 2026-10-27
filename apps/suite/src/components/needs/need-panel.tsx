'use client';
import type { CourseOption, NeedView } from '@jadarat/tms';
import { addNeedAction, updateNeedAction } from '@jadarat/tms/actions/needs';
import type { NeedsFormField } from '@jadarat/tms/needs-forms';
import type { MemberOption } from '@jadarat/platform-db';
import { personDisplayName } from '@jadarat/platform-i18n/names';
import { Alert, Button, Icon, SidePanel, TextField, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, useTransition } from 'react';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { ComboboxField } from '../combobox-field';
import { FieldControl } from '../needs-forms/needs-form-renderer';
import { useNeedsTexts } from './use-needs-texts';

export interface NeedPanelProps {
  readonly locale: 'ar' | 'en';
  readonly open: boolean;
  readonly onClose: () => void;
  /** Adding, or editing one need. */
  readonly need: NeedView | null;
  readonly cycleId: string;
  readonly departmentId: string;
  readonly currency: string;
  readonly team: readonly MemberOption[];
  readonly courses: readonly CourseOption[];
  /** The needs section's other fields, under «More» (the cycle's form). */
  readonly moreFields: readonly NeedsFormField[];
  readonly texts: Readonly<Record<string, string>>;
  /** Texts of the `needsForms` namespace for the form fields (renderer.*, fieldErrors.*, markers). */
  readonly formTexts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Draft {
  readonly topic: string;
  readonly courseId: string;
  readonly peopleCount: string;
  readonly personIds: readonly string[];
  readonly estimatedCost: string;
  readonly answers: Readonly<Record<string, unknown>>;
}

const EMPTY: Draft = {
  topic: '',
  courseId: '',
  peopleCount: '1',
  personIds: [],
  estimatedCost: '',
  answers: {},
};

function draftOf(need: NeedView | null): Draft {
  if (!need) return EMPTY;
  return {
    topic: need.topic,
    courseId: need.courseId ?? '',
    peopleCount: String(need.peopleCount),
    personIds: need.people.map((p) => p.personId),
    estimatedCost: need.estimatedCost ?? '',
    answers: need.answers,
  };
}

/**
 * «Add a need» / «Edit the need» (design screen 3, approved by the PO 27 Oct 2026): a side panel with the
 * training topic (typed, or picked from the course library), how many people (the seats — Q1), who
 * (optional names from the team; more names than seats raise the number), the organization's other fields
 * under «More», and the estimated cost. «Save and add another» keeps the panel open for the next need. The
 * server checks everything again; its field errors land on the fields.
 */
export function NeedPanel(props: NeedPanelProps) {
  const { t, message, fieldErrors } = useNeedsTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const base = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(props.need));
  const [opened, setOpened] = useState<NeedView | null | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);

  // A fresh draft each time the panel opens (adding) or opens another need (editing).
  if (props.open && opened !== props.need) {
    setOpened(props.need);
    setDraft(draftOf(props.need));
    setErrors({});
    setNotice(null);
    setMoreOpen(
      props.need !== null &&
        Object.keys(props.need.answers).length > 0 &&
        props.moreFields.length > 0,
    );
    setSearch('');
    setDirty(false);
  }
  if (!props.open && opened !== undefined) setOpened(undefined);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const clearError = (path: string) => {
    setErrors((e) => {
      if (!(path in e)) return e;
      const { [path]: _gone, ...rest } = e;
      return rest;
    });
  };

  const courseOptions = useMemo(
    () => [
      { value: '', label: t('panel.courseNone') },
      ...props.courses.map((c) => ({
        value: c.id,
        label: props.locale === 'ar' ? c.title.ar : c.title.en,
      })),
    ],
    [props.courses, props.locale, t],
  );
  const courseTitle = (id: string) => {
    const course = props.courses.find((c) => c.id === id);
    return course ? (props.locale === 'ar' ? course.title.ar : course.title.en) : '';
  };

  const chosen = new Set(draft.personIds);
  const shownTeam = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? props.team.filter((m) =>
          `${m.nameAr ?? ''} ${m.nameEn ?? ''}`.toLowerCase().includes(needle),
        )
      : props.team;
  }, [props.team, search]);

  const togglePerson = (personId: string) => {
    const next = chosen.has(personId)
      ? draft.personIds.filter((id) => id !== personId)
      : [...draft.personIds, personId];
    const count = Number(draft.peopleCount);
    update({
      personIds: next,
      // Q1: choosing more names than the number raises the number.
      peopleCount:
        Number.isFinite(count) && count >= next.length ? draft.peopleCount : String(next.length),
    });
    clearError('personIds');
    clearError('peopleCount');
  };
  const chooseEveryone = () => {
    const all = props.team.map((m) => m.personId);
    const count = Number(draft.peopleCount);
    update({
      personIds: all,
      peopleCount:
        Number.isFinite(count) && count >= all.length ? draft.peopleCount : String(all.length),
    });
  };

  function save(addAnother: boolean) {
    setNotice(null);
    const problems: Record<string, string> = {};
    const topic = draft.topic.trim();
    if (topic === '') problems.topic = t('fieldErrors.required');
    const count = Number(draft.peopleCount);
    if (!/^\d+$/.test(draft.peopleCount.trim()) || count < 1) {
      problems.peopleCount = t('fieldErrors.required');
    } else if (count < draft.personIds.length) {
      problems.peopleCount = t('fieldErrors.fewerThanNamed');
    }
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    const input = {
      cycleId: props.cycleId,
      departmentId: props.departmentId,
      topic,
      courseId: UUID_RE.test(draft.courseId) ? draft.courseId : null,
      peopleCount: count,
      personIds: [...draft.personIds],
      estimatedCost: draft.estimatedCost,
      answers: draft.answers,
    };
    startTransition(async () => {
      const result = props.need
        ? await updateNeedAction({ ...input, needId: props.need.id, version: props.need.version })
        : await addNeedAction(input);
      if (result.ok) {
        toast.success(t(props.need ? 'panel.saved' : 'panel.added'));
        router.refresh();
        if (addAnother) {
          setDraft(EMPTY);
          setErrors({});
          setMoreOpen(false);
          setSearch('');
          setDirty(false);
          document.getElementById(`${base}-topic`)?.focus();
        } else {
          setDirty(false);
          props.onClose();
        }
        return;
      }
      if (sessionRefused(result.error)) return;
      const byField = fieldErrors(result.error);
      // Field errors of named people point at the list; the «More» answers at their field.
      const mapped: Record<string, string> = {};
      for (const [path, text] of Object.entries(byField)) {
        mapped[path.startsWith('personIds') ? 'personIds' : path] = text;
      }
      setErrors(mapped);
      if (Object.keys(mapped).some((p) => p.startsWith('answers.'))) setMoreOpen(true);
      setNotice(
        result.error.code === 'VALIDATION_FAILED' && Object.keys(mapped).length > 0
          ? null
          : message(result.error),
      );
    });
  }

  const canClose = () => {
    if (pending) return false;
    if (!dirty) return true;
    return window.confirm(`${t('panel.discardTitle')}\n${t('panel.discardBody')}`);
  };
  const close = () => {
    if (canClose()) {
      setDirty(false);
      props.onClose();
    }
  };

  return (
    <SidePanel
      open={props.open}
      onClose={close}
      canClose={canClose}
      title={props.need ? t('panel.editTitle') : t('panel.addTitle')}
      description={t('panel.intro')}
      closeLabel={t('panel.close')}
      size="lg"
      data-testid="need-panel"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={pending}>
            {t('panel.cancel')}
          </Button>
          {props.need ? null : (
            <Button
              variant="secondary"
              onClick={() => {
                save(true);
              }}
              disabled={pending}
              data-testid="need-save-another"
            >
              {t('panel.saveAndAddAnother')}
            </Button>
          )}
          <Button
            onClick={() => {
              save(false);
            }}
            busy={pending}
            disabled={pending}
            data-testid="need-save"
          >
            {pending ? t('panel.working') : t('panel.save')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {notice ? (
          <Alert tone="danger" data-testid="need-error">
            {notice}
          </Alert>
        ) : null}

        {props.courses.length > 0 ? (
          <ComboboxField
            id={`${base}-course`}
            label={t('panel.course')}
            marker={t('optional')}
            hint={t('panel.courseHint')}
            value={draft.courseId}
            options={courseOptions}
            texts={{ typeToSearch: t('typeToSearch'), noMatches: t('noMatches') }}
            error={errors.courseId}
            disabled={pending}
            onChange={(value) => {
              const previous = courseTitle(draft.courseId);
              const keepTopic = draft.topic.trim() !== '' && draft.topic !== previous;
              update({ courseId: value, topic: keepTopic ? draft.topic : courseTitle(value) });
              clearError('courseId');
              clearError('topic');
            }}
            data-testid="need-course"
          />
        ) : null}

        <TextField
          id={`${base}-topic`}
          label={t('panel.topic')}
          marker={t('required')}
          hint={t('panel.topicHint')}
          value={draft.topic}
          maxLength={500}
          required
          error={errors.topic}
          disabled={pending}
          onChange={(event) => {
            update({ topic: event.target.value });
            clearError('topic');
          }}
          data-testid="need-topic"
        />

        <TextField
          id={`${base}-count`}
          type="number"
          inputMode="numeric"
          min={1}
          max={100000}
          step={1}
          label={t('panel.peopleCount')}
          marker={t('required')}
          hint={t('panel.peopleCountHint')}
          value={draft.peopleCount}
          required
          error={errors.peopleCount}
          disabled={pending}
          onChange={(event) => {
            update({ peopleCount: event.target.value });
            clearError('peopleCount');
          }}
          data-testid="need-count"
        />

        <fieldset
          className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
          aria-describedby={errors.personIds ? `${base}-people-error` : `${base}-people-hint`}
          data-testid="need-people"
        >
          <legend className="flex flex-wrap items-center gap-x-1 p-0 text-sm font-semibold">
            {t('panel.who')}
            <span className="font-normal text-text-subtle">{t('optional')}</span>
          </legend>
          <p id={`${base}-people-hint`} className="m-0 text-sm text-text-muted">
            {t('panel.whoHint')}
          </p>
          {props.team.length === 0 ? (
            <p className="m-0 text-sm text-text-muted">{t('page.teamSize', { count: 0 })}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium" data-testid="need-chosen">
                  {chosen.size === 0
                    ? t('panel.nobody')
                    : t('panel.chosen', { count: chosen.size })}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={chooseEveryone}
                  disabled={pending || chosen.size === props.team.length}
                  data-testid="need-everyone"
                >
                  <Icon name="people" />
                  {t('panel.everyone', { count: props.team.length })}
                </Button>
                {chosen.size > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      update({ personIds: [] });
                    }}
                    disabled={pending}
                  >
                    {t('panel.nobody')}
                  </Button>
                ) : null}
              </div>
              {props.team.length > 8 ? (
                <TextField
                  id={`${base}-search`}
                  type="search"
                  label={t('panel.searchTeam')}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                  disabled={pending}
                />
              ) : null}
              <ul
                className="m-0 flex max-h-64 list-none flex-col overflow-y-auto rounded-md border border-border p-0"
                aria-label={t('panel.who')}
              >
                {shownTeam.map((member) => {
                  const id = `${base}-p-${member.personId.slice(0, 8)}`;
                  return (
                    <li key={member.personId} className="border-b border-border last:border-b-0">
                      <label
                        htmlFor={id}
                        className={cn(
                          'flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm',
                          chosen.has(member.personId) && 'bg-primary-subtle',
                        )}
                      >
                        <input
                          id={id}
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={chosen.has(member.personId)}
                          disabled={pending}
                          onChange={() => {
                            togglePerson(member.personId);
                          }}
                        />
                        {personDisplayName(props.locale, member.nameAr, member.nameEn)}
                      </label>
                    </li>
                  );
                })}
                {shownTeam.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-text-muted">{t('noMatches')}</li>
                ) : null}
              </ul>
            </>
          )}
          {errors.personIds ? (
            <p id={`${base}-people-error`} className="m-0 text-sm font-medium text-danger">
              {errors.personIds}
            </p>
          ) : null}
        </fieldset>

        {props.moreFields.length > 0 ? (
          <div className="rounded-lg border border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-start text-sm font-semibold"
              aria-expanded={moreOpen}
              aria-controls={`${base}-more`}
              onClick={() => {
                setMoreOpen((v) => !v);
              }}
              data-testid="need-more"
            >
              <span>
                {t('panel.more')}
                <span className="ms-2 font-normal text-text-muted">{t('panel.moreHint')}</span>
              </span>
              <Icon name={moreOpen ? 'chevron-up' : 'chevron-down'} className="size-4" />
            </button>
            {moreOpen ? (
              <div id={`${base}-more`} className="flex flex-col gap-4 border-t border-border p-4">
                {props.moreFields.map((field) => (
                  <FieldControl
                    key={field.id}
                    field={field}
                    id={`${base}-f-${field.id.slice(0, 8)}`}
                    locale={props.locale}
                    value={draft.answers[field.id]}
                    error={errors[`answers.${field.id}`]}
                    text={(key, values = {}) => fillTexts(props.formTexts, key, values)}
                    errorMessage={(code) =>
                      props.formTexts[`fieldErrors.${code}`] ??
                      props.formTexts['fieldErrors.INVALID'] ??
                      ''
                    }
                    onChange={(value) => {
                      const { [field.id]: _old, ...rest } = draft.answers;
                      update({
                        answers:
                          value === undefined || value === ''
                            ? rest
                            : { ...rest, [field.id]: value },
                      });
                      clearError(`answers.${field.id}`);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <TextField
          id={`${base}-cost`}
          inputMode="decimal"
          dir="ltr"
          label={t('panel.estimatedCost', { currency: props.currency })}
          marker={t('optional')}
          hint={t('panel.estimatedCostHint')}
          value={draft.estimatedCost}
          error={errors.estimatedCost}
          disabled={pending}
          onChange={(event) => {
            update({ estimatedCost: event.target.value });
            clearError('estimatedCost');
          }}
          data-testid="need-cost"
        />
      </div>
    </SidePanel>
  );
}

/** A raw text of the `needsForms` namespace with its placeholders filled (the renderer's own helper). */
function fillTexts(
  texts: Readonly<Record<string, string>>,
  key: string,
  values: Record<string, string | number>,
): string {
  let text = texts[key] ?? key;
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}
