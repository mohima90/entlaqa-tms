'use client';
import type { DraftSessionDetailView } from '@jadarat/tms';
import { deleteDraftSessionAction, updateDraftSessionAction } from '@jadarat/tms/actions/sessions';
import { Alert, Avatar, Badge, Button, Dialog, Icon, TextField, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useMemo, useState, useTransition } from 'react';
import { parseSeats } from '../../lib/plan-delivery-view';
import type { ErrorTexts } from '../auth/error-text';
import { SelectField } from '../select-field';
import { usePlanTexts } from '../training-plan/use-plan-texts';

export interface DraftSessionDialogProps {
  readonly locale: 'ar' | 'en';
  readonly view: DraftSessionDetailView;
  /** The planning period's months with their names in the organization's date display. */
  readonly months: readonly { readonly value: string; readonly label: string }[];
  /** «Advanced Excel · CRS-014 · Classroom · 12 hours» (the course's link text and its facts). */
  readonly course: { readonly title: string; readonly facts: string; readonly href: string } | null;
  /** «Training plan 2027» (a link to the plan) and «Advanced Excel · Q1». */
  readonly plan: { readonly name: string; readonly facts: string; readonly href: string };
  /** «SAR 9,000» or null. */
  readonly cost: string | null;
  /** «Q1» of the line. */
  readonly quarter: string;
  /** Names of the departments of the line's people. */
  readonly departments: Readonly<Record<string, string>>;
  readonly closeHref: string;
  readonly preview: boolean;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

type Field = 'month' | 'branchId' | 'seats' | 'personIds';

/**
 * A draft session opened from the calendar (WP-LD-04, design screen 5): «Advanced Excel · session 1 of 3», *Draft*,
 * «Only the L&D team sees it. Nobody is invited yet.»; the course, where it comes from and its estimated cost;
 * Month* (another month is allowed and marked «outside the planned quarter»), Branch, Seats*; the planned
 * participants with «Add or move people» (people named for the line: in no session, or moved here from another
 * one) and the seats that wait for names; «Delete draft» at the start of the footer (with a confirmation), then
 * Cancel · Save. Read only for a planner whose departments do not cover the line.
 */
export function DraftSessionDialog(props: DraftSessionDialogProps) {
  const { locale, view } = props;
  const texts = usePlanTexts(props.texts, props.errors, locale);
  const { t } = texts;
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const initialPeople = useMemo(
    () => view.participants.map((p) => p.personId),
    [view.participants],
  );
  const [month, setMonth] = useState(view.session.month ?? '');
  const [branchId, setBranchId] = useState(view.session.branchId ?? '');
  const [seats, setSeats] = useState(String(view.session.seats));
  const [people, setPeople] = useState<readonly string[]>(initialPeople);
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string | undefined>>>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const editable = view.canEdit;
  const local = (name: { readonly ar: string | null; readonly en: string | null }) =>
    locale === 'ar' ? (name.ar ?? name.en ?? '') : (name.en ?? name.ar ?? '');
  const branchName = (id: string | null) =>
    id === null
      ? null
      : local(view.branches.find((b) => b.id === id)?.name ?? { ar: null, en: null });

  const person = useMemo(() => {
    const map = new Map<string, { name: string; detail: string; elsewhere: boolean }>();
    for (const p of view.participants) {
      map.set(p.personId, {
        name: local(p.name),
        detail: [local(p.departmentName), branchName(p.branchId)].filter(Boolean).join(' · '),
        elsewhere: false,
      });
    }
    for (const c of view.candidates) {
      map.set(c.personId, {
        name: local(c.name),
        detail: props.departments[c.departmentId] ?? '',
        elsewhere: c.sessionId !== null,
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the view and the locale are fixed while it is open
  }, [view]);

  const outside = month !== '' && !view.line.quarterMonths.includes(month);
  const go = (href: string) => {
    setOpen(false);
    router.replace(href, { scroll: false });
  };
  const close = () => {
    if (!pending) go(props.closeHref);
  };

  const refused = (error: Parameters<typeof texts.formMessage>[0]) => {
    if (texts.sessionRefused(error)) return;
    if (error.code === 'VALIDATION_FAILED') {
      const next: Partial<Record<Field, string>> = {};
      for (const fieldError of error.fieldErrors ?? []) {
        const field = (fieldError.path.split('.')[0] ?? '') as Field;
        if (['month', 'branchId', 'seats', 'personIds'].includes(field)) {
          next[field] ??= t(`draftDialog.fieldErrors.${fieldError.code}`);
        }
      }
      setErrors(next);
    }
    setMessage({ tone: 'danger', text: texts.formMessage(error) });
  };

  function onSave(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const count = parseSeats(seats);
    const problems: Partial<Record<Field, string>> = {};
    if (month === '') problems.month = t('draftDialog.fieldErrors.REQUIRED');
    if (count === null) problems.seats = t('draftDialog.fieldErrors.SEATS');
    else if (count < people.length) problems.seats = t('draftDialog.fieldErrors.FEWER_THAN_PEOPLE');
    setErrors(problems);
    if (Object.keys(problems).length > 0 || count === null) {
      setMessage({ tone: 'danger', text: props.errors['errors.validationFailed'] ?? '' });
      return;
    }
    if (props.preview) {
      setMessage({ tone: 'info', text: t('preview') });
      return;
    }
    const samePeople =
      people.length === initialPeople.length && people.every((id) => initialPeople.includes(id));
    const changes = {
      ...(month !== (view.session.month ?? '') ? { month } : {}),
      ...(branchId !== (view.session.branchId ?? '')
        ? { branchId: branchId === '' ? null : branchId }
        : {}),
      ...(count !== view.session.seats ? { seats: count } : {}),
      ...(samePeople ? {} : { personIds: [...people] }),
    };
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    startTransition(async () => {
      const result = await updateDraftSessionAction({
        sessionId: view.session.id,
        version: view.session.version,
        ...changes,
      });
      if (!result.ok) {
        refused(result.error);
        return;
      }
      toast.success(t('draftDialog.saved'));
      go(props.closeHref);
    });
  }

  function onDelete() {
    if (props.preview) {
      setConfirming(false);
      setMessage({ tone: 'info', text: t('preview') });
      return;
    }
    startTransition(async () => {
      const result = await deleteDraftSessionAction({
        sessionId: view.session.id,
        version: view.session.version,
      });
      setConfirming(false);
      if (!result.ok) {
        refused(result.error);
        return;
      }
      toast.success(t('draftDialog.deleted'));
      go(props.closeHref);
    });
  }

  const title =
    view.session.planned !== null
      ? t('draftDialog.title', {
          title: props.course?.title ?? view.line.title,
          number: view.session.ordinal,
          count: Math.max(view.session.planned, view.session.drafted),
        })
      : t('draftDialog.titleNoPlan', {
          title: props.course?.title ?? view.line.title,
          number: view.session.ordinal,
        });
  const candidates = view.candidates.filter((c) => !people.includes(c.personId));
  const removable = (id: string) => editable && !pending && people.includes(id);

  return (
    <>
      <Dialog
        open={open}
        onClose={close}
        canClose={() => !pending}
        size="rich"
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" className="border-dashed">
              {t('draftDialog.draft')}
            </Badge>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="eye-off" className="size-4" />
              {t('draftDialog.hidden')}
            </span>
          </span>
        }
        closeLabel={t('close')}
        data-testid="draft-session-dialog"
        footer={
          editable ? (
            <>
              <Button
                variant="ghost"
                className="text-danger! sm:me-auto"
                onClick={() => {
                  setConfirming(true);
                }}
                disabled={pending}
                data-testid="draft-session-delete"
              >
                <Icon name="trash" className="size-4" />
                {t('draftDialog.delete')}
              </Button>
              <Button
                variant="secondary"
                onClick={close}
                disabled={pending}
                data-testid="draft-session-cancel"
              >
                {t('draftDialog.cancel')}
              </Button>
              <Button
                type="submit"
                form="draft-session-form"
                disabled={pending}
                busy={pending}
                data-testid="draft-session-save"
              >
                {pending ? t('draftDialog.saving') : t('draftDialog.save')}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={close} data-testid="draft-session-cancel">
              {t('close')}
            </Button>
          )
        }
      >
        {!view.canEdit ? <Alert tone="info">{t('draftDialog.readOnly')}</Alert> : null}
        {message ? (
          <Alert tone={message.tone} data-testid="draft-session-message">
            {message.text}
          </Alert>
        ) : null}
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-text-muted">{t('draftDialog.course')}</dt>
          <dd className="m-0">
            {props.course ? (
              <>
                <a
                  href={props.course.href}
                  className="font-semibold text-primary-text underline underline-offset-2"
                >
                  {props.course.title}
                </a>
                <span className="text-text-muted"> · {props.course.facts}</span>
              </>
            ) : (
              '—'
            )}
          </dd>
          <dt className="text-text-muted">{t('draftDialog.fromPlan')}</dt>
          <dd className="m-0">
            <a
              href={props.plan.href}
              className="font-semibold text-primary-text underline underline-offset-2"
            >
              {props.plan.name}
            </a>
            <span className="text-text-muted"> · {props.plan.facts}</span>
          </dd>
          <dt className="text-text-muted">{t('draftDialog.cost')}</dt>
          <dd className="m-0">
            {props.cost === null ? (
              <span className="text-text-muted">{t('draftDialog.noCost')}</span>
            ) : (
              t('draftDialog.costValue', { amount: props.cost })
            )}
          </dd>
        </dl>

        <form
          id="draft-session-form"
          noValidate
          onSubmit={onSave}
          className="flex flex-col gap-4"
          data-testid="draft-session-form"
        >
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7.5rem]">
            <SelectField
              id="draft-session-month"
              label={t('draftDialog.month')}
              marker={t('required')}
              aria-required
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setErrors((e) => ({ ...e, month: undefined }));
              }}
              hint={
                outside ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-warning">
                    <Icon name="warning" className="size-3.5" />
                    {t('draftDialog.outside')}
                  </span>
                ) : (
                  t('draftDialog.monthHint', { quarter: props.quarter })
                )
              }
              error={errors.month}
              disabled={!editable || pending}
              data-testid="draft-session-month"
            >
              {month === '' ? <option value="">—</option> : null}
              {props.months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="draft-session-branch"
              label={t('draftDialog.branch')}
              marker={t('optional')}
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
                setErrors((e) => ({ ...e, branchId: undefined }));
              }}
              error={errors.branchId}
              disabled={!editable || pending}
              data-testid="draft-session-branch"
            >
              <option value="">
                {view.session.deliveryType === 'virtual' ||
                view.session.deliveryType === 'elearning'
                  ? t('draftDialog.online')
                  : t('draftDialog.noBranch')}
              </option>
              {view.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {local(b.name)}
                </option>
              ))}
            </SelectField>
            <TextField
              id="draft-session-seats"
              label={t('draftDialog.seats')}
              marker={t('required')}
              required
              value={seats}
              onChange={(event) => {
                setSeats(event.target.value);
                setErrors((e) => ({ ...e, seats: undefined }));
              }}
              inputMode="numeric"
              autoComplete="off"
              error={errors.seats}
              disabled={!editable || pending}
              data-testid="draft-session-seats"
            />
          </div>

          <section aria-labelledby="draft-session-people" className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="draft-session-people"
                className="m-0 text-[13px] font-semibold uppercase tracking-wide text-text-muted"
              >
                {t('draftDialog.participants', { count: people.length })}
              </h3>
              {editable && view.candidates.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={adding}
                  aria-controls="draft-session-candidates"
                  onClick={() => {
                    setAdding((value) => !value);
                  }}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 font-semibold text-primary-text hover:underline"
                  data-testid="draft-session-add"
                >
                  <Icon name="plus" className="size-4" />
                  {t('draftDialog.addPeople')}
                </button>
              ) : null}
            </div>
            {errors.personIds ? (
              <p className="m-0 text-[13.5px] font-semibold text-danger">{errors.personIds}</p>
            ) : null}
            <ul
              className="m-0 flex list-none flex-col rounded-xl border border-border p-0"
              data-testid="draft-session-people"
            >
              {people.length === 0 ? (
                <li className="px-4 py-3 text-text-muted">{t('draftDialog.noParticipants')}</li>
              ) : null}
              {people.map((id) => {
                const info = person.get(id);
                return (
                  <li
                    key={id}
                    className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                    data-testid="draft-session-person"
                  >
                    <Avatar name={info?.name ?? ''} size="sm" tone="soft" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{info?.name}</span>
                      <span className="text-sm text-text-muted">{info?.detail}</span>
                    </span>
                    {removable(id) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPeople((current) => current.filter((p) => p !== id));
                        }}
                        aria-label={t('draftDialog.remove', { name: info?.name ?? '' })}
                        className="grid size-10 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-danger pointer-coarse:size-11"
                        data-testid="draft-session-remove-person"
                      >
                        <Icon name="close" className="size-4" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
              {view.unnamedSeats.map((u) => (
                <li
                  key={u.departmentId}
                  className="border-t border-border px-4 py-2.5 text-sm font-semibold text-primary-text first:border-t-0"
                >
                  {t('draftDialog.unnamed', {
                    count: u.seats,
                    department: props.departments[u.departmentId] ?? '',
                  })}
                </li>
              ))}
            </ul>
            <div
              id="draft-session-candidates"
              hidden={!adding}
              className="flex flex-col gap-2 rounded-xl bg-surface-sunken p-3"
            >
              <p className="m-0 text-sm text-text-muted">{t('draftDialog.addHint')}</p>
              {candidates.length === 0 ? (
                <p className="m-0 text-sm">{t('draftDialog.noCandidates')}</p>
              ) : (
                <ul className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0">
                  {candidates.map((c) => {
                    const info = person.get(c.personId);
                    return (
                      <li key={c.personId}>
                        <button
                          type="button"
                          onClick={() => {
                            setPeople((current) => [...current, c.personId]);
                          }}
                          className={cn(
                            'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start hover:bg-surface',
                          )}
                          data-testid="draft-session-candidate"
                        >
                          <Icon name="plus" className="size-4 shrink-0 text-primary-text" />
                          <span className="flex min-w-0 flex-col">
                            <span className="font-semibold">{info?.name}</span>
                            <span className="text-sm text-text-muted">
                              {[
                                info?.detail,
                                c.sessionId === null
                                  ? t('draftDialog.notPlaced')
                                  : t('draftDialog.inAnother'),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </form>
        <div className="flex items-start gap-3 rounded-xl border border-info/35 bg-info-subtle px-4 py-3 text-info">
          <Icon name="clock" className="mt-0.5 size-4 shrink-0" />
          <p className="m-0 text-[14.5px]">{t('draftDialog.notScheduled')}</p>
        </div>
      </Dialog>
      <Dialog
        open={confirming}
        onClose={() => {
          if (!pending) setConfirming(false);
        }}
        canClose={() => !pending}
        size="sm"
        tone="danger"
        title={t('draftDialog.deleteTitle')}
        description={t('draftDialog.deleteBody', {
          number: view.session.ordinal,
          title: props.course?.title ?? view.line.title,
          count: people.length,
        })}
        closeLabel={t('close')}
        data-testid="draft-session-delete-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
              disabled={pending}
            >
              {t('draftDialog.keep')}
            </Button>
            <Button
              variant="danger"
              onClick={onDelete}
              disabled={pending}
              busy={pending}
              data-testid="draft-session-delete-confirm"
            >
              {t('draftDialog.deleteConfirm')}
            </Button>
          </>
        }
      />
    </>
  );
}
