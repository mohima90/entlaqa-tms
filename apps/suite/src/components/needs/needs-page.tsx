'use client';
import type { DateDisplay } from '@jadarat/platform-i18n';
import { formatDisplayDate } from '@jadarat/platform-i18n/dates';
import { personDisplayName } from '@jadarat/platform-i18n/names';
import type { DepartmentNeedsView, NeedView } from '@jadarat/tms';
import {
  deleteNeedAction,
  extendDepartmentDeadlineAction,
  recallNeedsAction,
  returnNeedsAction,
  saveDepartmentAnswersAction,
  submitNeedsAction,
} from '@jadarat/tms/actions/needs';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Icon,
  ListCard,
  ListCards,
  ProgressBar,
  StatCard,
  StatGrid,
  TextField,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { NEEDS_TONE } from '../../lib/needs-view';
import { dayFormatter, formatAmount } from '../../lib/planning-format';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { NeedsFormRenderer, type NeedsFormAnswers } from '../needs-forms/needs-form-renderer';
import { NeedPanel } from './need-panel';
import { useNeedsTexts } from './use-needs-texts';

export interface NeedsPageProps {
  readonly locale: 'ar' | 'en';
  readonly view: DepartmentNeedsView;
  /** The unit's name with its level, as the page header shows it. */
  readonly departmentLabel: string;
  /** The form status in words (the planning catalog's `cycle.formStatus.*`). */
  readonly statusLabel: string;
  readonly display: DateDisplay;
  readonly timeZone: string;
  readonly texts: Readonly<Record<string, string>>;
  readonly formTexts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * A department's training needs (design screens 2 and 4, approved 27 Oct 2026): the banners that matter
 * (returned with the note, late, submitted, closed), the figures (needs, seats named / unnamed, estimated
 * cost against the envelope — shown, never a block, Q2), the needs table with Edit / Remove while entry is
 * open, «Add a need», «Submit» with its summary, «Recall» until the deadline. The L&D Manager sees the same
 * page read-only with «Return for changes» and «Extend for this department» (screen 5). Every rule is
 * checked again on the server and in the database.
 */
export function NeedsPage(props: NeedsPageProps) {
  const { view, locale } = props;
  const { t, message, fieldErrors } = useNeedsTexts(props.texts, props.errors, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const day = dayFormatter(locale, props.display);
  const amount = (value: string | number) => formatAmount(locale, value, view.cycle.currency);
  const when = (iso: string) =>
    formatDisplayDate(iso, {
      locale,
      display: props.display,
      timeZone: props.timeZone,
      style: 'dateTime',
    });

  const [panel, setPanel] = useState<{ open: boolean; need: NeedView | null }>({
    open: false,
    need: null,
  });
  const [removing, setRemoving] = useState<NeedView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const [returning, setReturning] = useState(false);
  const [extending, setExtending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ref = {
    cycleId: view.cycle.id,
    departmentId: view.department.id,
    version: view.department.version,
  };

  function run(
    action: () => Promise<{ ok: true } | { ok: false; error: Parameters<typeof message>[0] }>,
    done: string,
    close: () => void,
  ) {
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        close();
        toast.success(done);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setNotice(message(result.error));
    });
  }

  const isHead = view.role === 'head';
  const closedByCycle = view.cycle.status !== 'open';
  const banner: ReactNode = (() => {
    if (view.status === 'returned' && view.returnNote) {
      return (
        <Alert tone="warning" data-testid="needs-returned">
          {t('page.returnedBanner', { note: view.returnNote })}
        </Alert>
      );
    }
    if (
      closedByCycle &&
      view.cycle.status === 'closed' &&
      !view.entryOpen &&
      view.status !== 'submitted'
    ) {
      return <Alert tone="info">{t('page.closedBanner')}</Alert>;
    }
    if (view.status === 'late') {
      return (
        <Alert tone="danger" data-testid="needs-late">
          {t('page.lateBanner', { date: day(view.deadline) })}
        </Alert>
      );
    }
    if (view.status === 'submitted' && isHead) {
      return (
        <Alert tone="success" data-testid="needs-submitted">
          {t('page.submittedBanner')}
        </Alert>
      );
    }
    return null;
  })();

  const envelopeLine = (() => {
    if (view.budgetAmount === null) return t('page.envelopeNone');
    if (view.envelope.kind === 'over') {
      return t('page.envelopeOver', {
        over: amount(view.envelope.overBy),
        envelope: amount(view.budgetAmount),
      });
    }
    return t('page.envelopeWithin', {
      left: view.envelope.kind === 'within' ? amount(view.envelope.left) : '',
      envelope: amount(view.budgetAmount),
    });
  })();
  const costValue = view.totals.cost === null ? 0 : Number(view.totals.cost);
  const envelopeValue = view.budgetAmount === null ? null : Number(view.budgetAmount);

  const instructions =
    locale === 'ar'
      ? (view.cycle.instructions.ar ?? view.cycle.instructions.en)
      : (view.cycle.instructions.en ?? view.cycle.instructions.ar);

  return (
    <div className="flex flex-col gap-5.5">
      {banner}
      {view.role === 'manager' ? <Alert tone="info">{t('page.readOnly')}</Alert> : null}

      <div className="flex flex-wrap items-center justify-end gap-2" data-testid="needs-toolbar">
        {view.can.edit ? (
          <Button
            variant="secondary"
            onClick={() => {
              setPanel({ open: true, need: null });
            }}
            data-testid="need-add"
          >
            <Icon name="plus" />
            {t('page.add')}
          </Button>
        ) : null}
        {isHead && view.can.edit ? (
          <Button
            onClick={() => {
              setSubmitting(true);
            }}
            disabled={!view.can.submit}
            aria-describedby={view.can.submit ? undefined : 'needs-submit-hint'}
            data-testid="needs-submit"
          >
            <Icon name="send" />
            {t('page.submit')}
          </Button>
        ) : null}
        {view.can.recall ? (
          <Button
            variant="secondary"
            onClick={() => {
              setRecalling(true);
            }}
            data-testid="needs-recall"
          >
            <Icon name="undo" />
            {t('page.recall')}
          </Button>
        ) : null}
        {view.can.return ? (
          <Button
            variant="secondary"
            onClick={() => {
              setReturning(true);
            }}
            data-testid="needs-return"
          >
            <Icon name="undo" />
            {t('manager.return')}
          </Button>
        ) : null}
        {view.can.extend ? (
          <Button
            variant="secondary"
            onClick={() => {
              setExtending(true);
            }}
            data-testid="needs-extend"
          >
            <Icon name="calendar" />
            {t('manager.extend')}
          </Button>
        ) : null}
      </div>
      {isHead && view.can.edit && !view.can.submit ? (
        <p id="needs-submit-hint" className="m-0 -mt-3 text-end text-sm text-text-muted">
          {t('page.submitDisabledHint')}
        </p>
      ) : null}
      {view.can.recall ? (
        <p className="m-0 -mt-3 text-end text-sm text-text-muted">
          {t('page.recallHint', { date: day(view.deadline) })}
        </p>
      ) : null}

      {instructions ? (
        <Card title={t('page.instructions')} icon="info" data-testid="needs-instructions">
          <p className="m-0 whitespace-pre-line">{instructions}</p>
        </Card>
      ) : null}

      <StatGrid label={t('page.statsLabel')} columns={4} data-testid="needs-stats">
        <StatCard label={t('page.stats.needs')} value={String(view.totals.needs)} icon="form" />
        <StatCard
          label={t('page.stats.seats')}
          value={String(view.totals.seats)}
          icon="people"
          hint={`${t('page.stats.named')}: ${String(view.totals.named)} · ${t('page.stats.unnamed')}: ${String(view.totals.unnamed)}`}
        />
        <StatCard
          label={t('page.stats.cost')}
          value={view.totals.cost === null ? t('page.noCost') : amount(view.totals.cost)}
          icon="wallet"
          tone={view.envelope.kind === 'over' ? 'warning' : undefined}
          hint={
            <span className="flex flex-col gap-1.5">
              {envelopeValue !== null ? (
                <ProgressBar
                  value={Math.min(costValue, envelopeValue)}
                  max={Math.max(envelopeValue, 1)}
                  label={envelopeLine}
                />
              ) : null}
              <span data-testid="needs-envelope">{envelopeLine}</span>
            </span>
          }
        />
        <StatCard
          label={
            view.deadline !== view.cycle.deadline ? t('page.extendedDeadline') : t('page.deadline')
          }
          value={day(view.deadline)}
          icon="calendar"
          hint={
            <Badge tone={NEEDS_TONE[view.status]} dot data-testid="needs-status">
              {props.statusLabel}
            </Badge>
          }
        />
      </StatGrid>

      <Card
        title={t('page.tableCaption', { department: props.departmentLabel })}
        description={
          isHead && view.team.length > 0
            ? t('page.teamSize', { count: view.team.length })
            : undefined
        }
        data-testid="needs-card"
      >
        {view.needs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong bg-surface-sunken">
            <EmptyState
              icon="form"
              title={t('page.emptyTitle')}
              description={t('page.emptyBody')}
              headingLevel={3}
              action={
                view.can.edit ? (
                  <Button
                    onClick={() => {
                      setPanel({ open: true, need: null });
                    }}
                    data-testid="need-add-first"
                  >
                    <Icon name="plus" />
                    {t('page.addFirst')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <div className={`${tableClasses.wrapper} hidden md:block`}>
              <table className={tableClasses.table} data-testid="needs-table">
                <caption className="sr-only">
                  {t('page.tableCaption', { department: props.departmentLabel })}
                </caption>
                <thead className={tableClasses.header}>
                  <tr>
                    <th scope="col" className={tableClasses.head}>
                      {t('page.columns.topic')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('page.columns.people')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('page.columns.cost')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('page.columns.updated')}
                    </th>
                    {view.can.edit ? (
                      <th scope="col" className={tableClasses.head}>
                        {t('page.columns.actions')}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {view.needs.map((need) => (
                    <tr key={need.id} className={tableClasses.row} data-testid="need-row">
                      <th scope="row" className={`${tableClasses.cell} text-start font-medium`}>
                        <span className="block">{need.topic}</span>
                        {need.courseId ? (
                          <span className="text-[13px] font-normal text-text-muted">
                            {t('page.fromLibrary')}
                          </span>
                        ) : null}
                      </th>
                      <td className={tableClasses.cell}>
                        <PeopleCell need={need} locale={locale} t={t} />
                      </td>
                      <td className={`${tableClasses.cell} tabular-nums`}>
                        {need.estimatedCost === null
                          ? t('page.noCost')
                          : amount(need.estimatedCost)}
                      </td>
                      <td className={tableClasses.cell}>{when(need.updatedAt)}</td>
                      {view.can.edit ? (
                        <td className={tableClasses.cell}>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t('page.edit', { topic: need.topic })}
                              onClick={() => {
                                setPanel({ open: true, need });
                              }}
                              data-testid="need-edit"
                            >
                              <Icon name="pencil" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-danger hover:bg-danger-subtle"
                              aria-label={t('page.remove', { topic: need.topic })}
                              onClick={() => {
                                setRemoving(need);
                              }}
                              data-testid="need-remove"
                            >
                              <Icon name="trash" />
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListCards aria-label={t('page.tableCaption', { department: props.departmentLabel })}>
              {view.needs.map((need) => (
                <ListCard
                  key={need.id}
                  title={need.topic}
                  detail={
                    <>
                      <span className="block">
                        <PeopleCell need={need} locale={locale} t={t} />
                      </span>
                      <span className="block">
                        {need.estimatedCost === null
                          ? t('page.noCost')
                          : amount(need.estimatedCost)}
                      </span>
                    </>
                  }
                  action={
                    view.can.edit ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('page.edit', { topic: need.topic })}
                        onClick={() => {
                          setPanel({ open: true, need });
                        }}
                      >
                        <Icon name="pencil" />
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </ListCards>
          </>
        )}
      </Card>

      {view.form && view.form.otherSections.length > 0 ? (
        <DepartmentAnswers
          view={view}
          locale={locale}
          t={t}
          formTexts={props.formTexts}
          message={message}
        />
      ) : null}

      {view.submittedAt ? (
        <p className="m-0 text-sm text-text-muted" data-testid="needs-submitted-on">
          {t('page.submittedOn', {
            date: when(view.submittedAt),
            by: view.submittedBy
              ? personDisplayName(locale, view.submittedBy.ar, view.submittedBy.en) || 'none'
              : 'none',
          })}
        </p>
      ) : null}

      {isHead ? (
        <NeedPanel
          locale={locale}
          open={panel.open}
          onClose={() => {
            setPanel({ open: false, need: null });
          }}
          need={panel.need}
          cycleId={view.cycle.id}
          departmentId={view.department.id}
          currency={view.cycle.currency}
          team={view.team}
          courses={view.courses}
          moreFields={view.form?.moreFields ?? []}
          texts={props.texts}
          formTexts={props.formTexts}
          errors={props.errors}
        />
      ) : null}

      {/* Remove a need */}
      <Dialog
        open={removing !== null}
        onClose={() => {
          if (!pending) setRemoving(null);
        }}
        title={t('page.removeTitle')}
        description={removing ? t('page.removeBody', { topic: removing.topic }) : undefined}
        closeLabel={t('panel.close')}
        size="sm"
        tone="danger"
        data-testid="need-remove-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRemoving(null);
              }}
              disabled={pending}
            >
              {t('page.keep')}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (!removing) return;
                const need = removing;
                run(
                  () =>
                    deleteNeedAction({
                      cycleId: view.cycle.id,
                      departmentId: view.department.id,
                      needId: need.id,
                      version: need.version,
                    }),
                  t('page.removed'),
                  () => {
                    setRemoving(null);
                  },
                );
              }}
              data-testid="need-remove-confirm"
            >
              {pending ? t('panel.working') : t('page.removeConfirm')}
            </Button>
          </>
        }
      >
        {notice ? <Alert tone="danger">{notice}</Alert> : null}
      </Dialog>

      {/* Submit summary */}
      <Dialog
        open={submitting}
        onClose={() => {
          if (!pending) setSubmitting(false);
        }}
        title={t('submitDialog.title', { department: props.departmentLabel })}
        description={t('submitDialog.body', { date: day(view.deadline) })}
        closeLabel={t('panel.close')}
        size="md"
        data-testid="needs-submit-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setSubmitting(false);
              }}
              disabled={pending}
            >
              {t('submitDialog.cancel')}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                run(
                  () => submitNeedsAction(ref),
                  t('submitDialog.submitted'),
                  () => {
                    setSubmitting(false);
                  },
                );
              }}
              data-testid="needs-submit-confirm"
            >
              {pending ? t('panel.working') : t('submitDialog.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {notice ? <Alert tone="danger">{notice}</Alert> : null}
          <dl
            className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm"
            data-testid="needs-summary"
          >
            <SummaryRow label={t('submitDialog.rows.needs')} value={String(view.totals.needs)} />
            <SummaryRow label={t('submitDialog.rows.seats')} value={String(view.totals.seats)} />
            <SummaryRow label={t('submitDialog.rows.named')} value={String(view.totals.named)} />
            <SummaryRow
              label={t('submitDialog.rows.unnamed')}
              value={String(view.totals.unnamed)}
            />
            <SummaryRow
              label={t('submitDialog.rows.cost')}
              value={view.totals.cost === null ? t('page.noCost') : amount(view.totals.cost)}
            />
            {view.budgetAmount !== null ? (
              <SummaryRow
                label={t('submitDialog.rows.envelope')}
                value={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {amount(view.budgetAmount)}
                    <Badge tone={view.envelope.kind === 'over' ? 'warning' : 'success'} dot>
                      {view.envelope.kind === 'over'
                        ? t('submitDialog.over', { amount: amount(view.envelope.overBy) })
                        : t('submitDialog.within')}
                    </Badge>
                  </span>
                }
              />
            ) : null}
          </dl>
        </div>
      </Dialog>

      {/* Recall */}
      <Dialog
        open={recalling}
        onClose={() => {
          if (!pending) setRecalling(false);
        }}
        title={t('recallDialog.title')}
        description={t('recallDialog.body', { date: day(view.deadline) })}
        closeLabel={t('panel.close')}
        size="sm"
        tone="warning"
        data-testid="needs-recall-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRecalling(false);
              }}
              disabled={pending}
            >
              {t('recallDialog.cancel')}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                run(
                  () => recallNeedsAction(ref),
                  t('recallDialog.recalled'),
                  () => {
                    setRecalling(false);
                  },
                );
              }}
              data-testid="needs-recall-confirm"
            >
              {pending ? t('panel.working') : t('recallDialog.confirm')}
            </Button>
          </>
        }
      >
        {notice ? <Alert tone="danger">{notice}</Alert> : null}
      </Dialog>

      {view.can.return ? (
        <ReturnDialog
          open={returning}
          onClose={() => {
            setReturning(false);
          }}
          departmentLabel={props.departmentLabel}
          departmentRef={ref}
          t={t}
          message={message}
          fieldErrors={fieldErrors}
          sessionRefused={sessionRefused}
        />
      ) : null}
      {view.can.extend ? (
        <ExtendDialog
          open={extending}
          onClose={() => {
            setExtending(false);
          }}
          departmentLabel={props.departmentLabel}
          departmentRef={ref}
          current={view.deadline}
          today={view.today}
          periodEnd={view.cycle.periodEnd}
          day={day}
          t={t}
          message={message}
          fieldErrors={fieldErrors}
          sessionRefused={sessionRefused}
        />
      ) : null}
    </div>
  );
}

type T = (key: string, values?: Readonly<Record<string, string | number>>) => string;

/** A stored answer as text (the read-only department answers): «—» for nothing, lists joined, people counted. */
function answerText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '✓' : '—';
  if (Array.isArray(value)) return value.map((v) => answerText(v)).join('، ');
  if (typeof value === 'object') {
    const people = value as { count?: unknown; personIds?: unknown };
    const parts: string[] = [];
    if (typeof people.count === 'number') parts.push(String(people.count));
    if (Array.isArray(people.personIds)) parts.push(`+${String(people.personIds.length)}`);
    return parts.join(' ') || '—';
  }
  return '—';
}

function PeopleCell({ need, locale, t }: { need: NeedView; locale: 'ar' | 'en'; t: T }) {
  const named = need.people.length;
  if (named === 0) return <>{t('page.peopleCell', { count: need.peopleCount })}</>;
  const names = need.people
    .slice(0, 3)
    .map((p) => personDisplayName(locale, p.name.ar, p.name.en))
    .join('، ');
  return (
    <span className="flex flex-col">
      <span>{t('page.namedCell', { named, count: need.peopleCount })}</span>
      <span className="text-[13px] text-text-muted">
        {names}
        {need.people.length > 3 ? ' …' : ''}
      </span>
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="m-0 text-text-muted">{label}</dt>
      <dd className="m-0 font-semibold tabular-nums">{value}</dd>
    </>
  );
}

/** The cycle form's sections answered once per department (editable by the head while entry is open). */
function DepartmentAnswers({
  view,
  locale,
  t,
  formTexts,
  message,
}: {
  view: DepartmentNeedsView;
  locale: 'ar' | 'en';
  t: T;
  formTexts: Readonly<Record<string, string>>;
  message: (error: Parameters<ReturnType<typeof useNeedsTexts>['message']>[0]) => string;
}) {
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [answers, setAnswers] = useState<NeedsFormAnswers>(view.answers as NeedsFormAnswers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!view.form) return null;
  const form = { id: view.form.id, sections: view.form.otherSections };
  if (!view.can.edit) {
    return (
      <Card title={t('page.departmentAnswersTitle')} data-testid="department-answers">
        <dl className="m-0 flex flex-col gap-3">
          {form.sections.map((section) => (
            <div key={section.id} className="flex flex-col gap-1">
              <dt className="font-semibold">
                {locale === 'ar' ? section.name.ar : section.name.en}
              </dt>
              {section.fields
                .filter((f) => f.visible)
                .map((field) => {
                  const entries = (view.answers[section.id] ?? []) as Record<string, unknown>[];
                  const value = entries[0]?.[field.id];
                  return (
                    <dd key={field.id} className="m-0 text-sm">
                      <span className="text-text-muted">
                        {locale === 'ar' ? field.label.ar : field.label.en}:
                      </span>{' '}
                      {answerText(value)}
                    </dd>
                  );
                })}
            </div>
          ))}
        </dl>
      </Card>
    );
  }
  return (
    <Card
      title={t('page.departmentAnswersTitle')}
      data-testid="department-answers"
      actions={
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            setNotice(null);
            startTransition(async () => {
              const result = await saveDepartmentAnswersAction({
                cycleId: view.cycle.id,
                departmentId: view.department.id,
                answers,
              });
              if (result.ok) {
                setErrors({});
                toast.success(t('page.departmentAnswersSaved'));
                router.refresh();
                return;
              }
              if (sessionRefused(result.error)) return;
              const out: Record<string, string> = {};
              for (const fe of result.error.fieldErrors ?? []) out[fe.path] = fe.code;
              setErrors(out);
              setNotice(message(result.error));
            });
          }}
          data-testid="department-answers-save"
        >
          {pending ? t('panel.working') : t('page.departmentAnswersSave')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {notice ? <Alert tone="danger">{notice}</Alert> : null}
        <NeedsFormRenderer
          form={form}
          locale={locale}
          answers={answers}
          onChange={setAnswers}
          texts={formTexts}
          errors={errors}
          idPrefix="dept"
        />
      </div>
    </Card>
  );
}

function ReturnDialog(props: {
  open: boolean;
  onClose: () => void;
  departmentLabel: string;
  departmentRef: { cycleId: string; departmentId: string; version: number };
  t: T;
  message: (error: Parameters<ReturnType<typeof useNeedsTexts>['message']>[0]) => string;
  fieldErrors: ReturnType<typeof useNeedsTexts>['fieldErrors'];
  sessionRefused: ReturnType<typeof useSessionRefusal>;
}) {
  const { t } = props;
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={props.open}
      onClose={() => {
        if (!pending) props.onClose();
      }}
      title={t('manager.returnTitle', { department: props.departmentLabel })}
      description={t('manager.returnBody')}
      closeLabel={t('panel.close')}
      size="sm"
      tone="warning"
      data-testid="needs-return-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose} disabled={pending}>
            {t('panel.cancel')}
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (note.trim() === '') {
                setError(t('fieldErrors.required'));
                return;
              }
              setNotice(null);
              startTransition(async () => {
                const result = await returnNeedsAction({
                  ...props.departmentRef,
                  note: note.trim(),
                });
                if (result.ok) {
                  props.onClose();
                  toast.success(t('manager.returned'));
                  router.refresh();
                  return;
                }
                if (props.sessionRefused(result.error)) return;
                setError(props.fieldErrors(result.error).note);
                setNotice(props.message(result.error));
              });
            }}
            data-testid="needs-return-confirm"
          >
            {pending ? t('panel.working') : t('manager.returnConfirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {notice ? <Alert tone="danger">{notice}</Alert> : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="needs-return-note" className="text-sm font-semibold">
            {t('manager.returnLabel')}
          </label>
          <textarea
            id="needs-return-note"
            rows={4}
            maxLength={500}
            value={note}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'needs-return-note-error' : 'needs-return-note-hint'}
            onChange={(event) => {
              setNote(event.target.value);
              setError(undefined);
            }}
            disabled={pending}
            className="w-full rounded-md border-[1.5px] border-border-strong bg-surface px-3.5 py-2 text-[15px] text-text focus:border-primary"
            data-testid="needs-return-note"
          />
          <p id="needs-return-note-hint" className="m-0 text-sm text-text-muted">
            {t('manager.returnHint')}
          </p>
          {error ? (
            <p id="needs-return-note-error" className="m-0 text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function ExtendDialog(props: {
  open: boolean;
  onClose: () => void;
  departmentLabel: string;
  departmentRef: { cycleId: string; departmentId: string; version: number };
  current: string;
  today: string;
  periodEnd: string;
  day: (d: string) => string;
  t: T;
  message: (error: Parameters<ReturnType<typeof useNeedsTexts>['message']>[0]) => string;
  fieldErrors: ReturnType<typeof useNeedsTexts>['fieldErrors'];
  sessionRefused: ReturnType<typeof useSessionRefusal>;
}) {
  const { t } = props;
  const router = useRouter();
  const earliest = (() => {
    const next = new Date(`${props.current}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const day = next.toISOString().slice(0, 10);
    return day > props.today ? day : props.today;
  })();
  const [deadline, setDeadline] = useState(earliest <= props.periodEnd ? earliest : props.current);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={props.open}
      onClose={() => {
        if (!pending) props.onClose();
      }}
      title={t('manager.extendTitle', { department: props.departmentLabel })}
      closeLabel={t('panel.close')}
      size="sm"
      data-testid="needs-extend-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose} disabled={pending}>
            {t('panel.cancel')}
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              const problem =
                deadline <= props.current
                  ? 'notLater'
                  : deadline < props.today
                    ? 'inPast'
                    : deadline > props.periodEnd
                      ? 'afterPeriod'
                      : null;
              if (problem) {
                setError(t(`fieldErrors.${problem}`));
                return;
              }
              setNotice(null);
              startTransition(async () => {
                const result = await extendDepartmentDeadlineAction({
                  ...props.departmentRef,
                  deadline,
                });
                if (result.ok) {
                  props.onClose();
                  toast.success(t('manager.extended'));
                  router.refresh();
                  return;
                }
                if (props.sessionRefused(result.error)) return;
                setError(props.fieldErrors(result.error).deadline);
                setNotice(props.message(result.error));
              });
            }}
            data-testid="needs-extend-confirm"
          >
            {pending ? t('panel.working') : t('manager.extendConfirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {notice ? <Alert tone="danger">{notice}</Alert> : null}
        <TextField
          id="needs-extend-deadline"
          type="date"
          label={t('manager.extendLabel')}
          hint={t('manager.extendHint', {
            current: props.day(props.current),
            end: props.day(props.periodEnd),
          })}
          value={deadline}
          min={earliest}
          max={props.periodEnd}
          onChange={(event) => {
            setDeadline(event.target.value);
            setError(undefined);
          }}
          error={error}
          disabled={pending}
        />
        {/^\d{4}-\d{2}-\d{2}$/.test(deadline) && !error ? (
          <p className="m-0 inline-flex w-fit items-center gap-2 rounded-[10px] bg-primary-subtle px-3 py-1.5 text-[13.5px] font-semibold text-primary-text">
            <Icon name="calendar" className="size-3.5" />
            {t('shownAs', { date: props.day(deadline) })}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
