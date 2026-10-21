'use client';
import type { CourseRow } from '@jadarat/tms/courses';
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FilterBar,
  FilterMenu,
  type FilterMenuOption,
  Icon,
  ListCard,
  ListCards,
  ListSearch,
  PageHeader,
  SidePanel,
  ViewCards,
  buttonClasses,
  cn,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { setCourseStatusAction } from '../../actions/courses';
import { type CoursesParams, coursesHref } from '../../lib/courses-view';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { CourseForm, type CourseFormSharedProps } from './course-form';

/** A course with what the list shows about it, formatted on the server (plural forms, amounts). */
export interface CourseListItem {
  readonly course: CourseRow;
  readonly title: string;
  readonly otherTitle: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly deliveryType: string;
  readonly duration: string;
  readonly durationDays: string | null;
  readonly participants: string;
  readonly costSession: string | null;
  readonly costParticipant: string | null;
}

export interface CoursesScreenProps {
  readonly locale: 'ar' | 'en';
  readonly items: readonly CourseListItem[];
  readonly params: CoursesParams;
  readonly counts: { readonly total: string; readonly active: string; readonly archived: string };
  readonly categoryOptions: readonly FilterMenuOption[];
  readonly deliveryOptions: readonly FilterMenuOption[];
  readonly canManage: boolean;
  readonly canArchive: boolean;
  readonly canSeeCosts: boolean;
  readonly truncated: boolean;
  readonly form: CourseFormSharedProps;
  /** The `courses` messages, raw; plus `required`, `optional`, `undo`. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** Banners under the header (preview, invalid filters). */
  readonly notices?: ReactNode;
}

type Panel =
  | { readonly kind: 'view'; readonly id: string }
  | { readonly kind: 'edit'; readonly id: string }
  | { readonly kind: 'add' }
  | null;

/** Milliseconds the search waits after the last key before it applies (the list is a server read). */
const SEARCH_PAUSE = 400;
const FORM_ID = 'course-panel-form';
const MENU_TRIGGER =
  'grid size-9 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11';

/**
 * The course library (T-M3-03; FR-CAT-01, FR-CAT-10; redesign package 4 — Deel, Uxcel, Teachable, Notion
 * Mail): view cards (All · Active · Archived) as the status filter; search and filter pills that apply at
 * once (same query, same address); a table with the course as code + title + the title in the other
 * language (cards on phones); a course opens in a read panel with Edit / Archive; Add and Edit in a side
 * panel; Archive and Restore without a confirmation, with Undo in the toast (each is the other's action,
 * both audited).
 */
export function CoursesScreen(props: CoursesScreenProps) {
  const { locale, params, texts } = props;
  const text = useCallback(
    (key: string, values: Record<string, string> = {}) => {
      let value = texts[key] ?? key;
      for (const [name, replacement] of Object.entries(values)) {
        value = value.replaceAll(`{${name}}`, replacement);
      }
      return value;
    },
    [texts],
  );
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [, startNavigation] = useTransition();
  const [statusPending, startStatus] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [formPending, setFormPending] = useState(false);
  const [query, setQuery] = useState(params.q ?? '');
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const go = (changes: Partial<Record<keyof CoursesParams, string | undefined>>) => {
    const next: Record<string, string | undefined> = { ...latest.current, ...changes };
    const clean = Object.fromEntries(
      Object.entries(next).filter((entry): entry is [string, string] => Boolean(entry[1])),
    ) as CoursesParams;
    startNavigation(() => {
      router.replace(coursesHref(locale, clean), { scroll: false });
    });
  };
  const applySearch = (value: string) => {
    window.clearTimeout(timer.current);
    const q = value.trim();
    if (q === (latest.current.q ?? '')) return;
    go({ q: q === '' ? undefined : q });
  };

  const byId = (id: string) => props.items.find((item) => item.course.id === id) ?? null;
  const viewing = panel?.kind === 'view' ? byId(panel.id) : null;
  const editing = panel?.kind === 'edit' ? byId(panel.id) : null;

  /** Archive or restore; Undo in the toast is the opposite action (both audited as before). */
  function setStatus(item: CourseListItem, archive: boolean, undo = true) {
    if (props.form.preview) {
      toast.info(text('previewNotSaved'));
      return;
    }
    startStatus(async () => {
      const result = await setCourseStatusAction({
        id: item.course.id,
        version: item.course.version,
        status: archive ? 'archived' : 'active',
      });
      if (result.ok) {
        setPanel(null);
        toast.success(archive ? text('archived') : text('restored'), {
          ...(undo
            ? {
                duration: 10_000,
                action: {
                  label: text('undo'),
                  onClick: () => {
                    setStatus({ ...item, course: result.value.after }, !archive, false);
                  },
                },
              }
            : {}),
        });
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      toast.error(
        result.error.code === 'CONFLICT_VERSION'
          ? text('conflict')
          : result.error.code === 'NOT_FOUND'
            ? text('notFound')
            : errorText(result.error, props.errors),
      );
    });
  }

  const statusBadge = (item: CourseListItem) => (
    <Badge tone={item.course.status === 'active' ? 'success' : 'neutral'} dot>
      {text(`statuses.${item.course.status}`)}
    </Badge>
  );
  const showMenu = props.canManage || props.canArchive;
  const rowMenu = (item: CourseListItem) => {
    const { code } = item.course;
    const active = item.course.status === 'active';
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className={MENU_TRIGGER}
          aria-label={`${text('columns.actions')}: ${code}`}
          disabled={statusPending}
          data-testid={`course-menu-${code}`}
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() => {
              setPanel({ kind: 'view', id: item.course.id });
            }}
            data-testid={`course-view-${code}`}
          >
            <Icon name="eye" />
            {item.title}
          </DropdownMenuItem>
          {props.canManage && active ? (
            <DropdownMenuItem
              onSelect={() => {
                setPanel({ kind: 'edit', id: item.course.id });
              }}
              data-testid={`course-edit-${code}`}
            >
              <Icon name="pencil" />
              {text('editCourse', { code })}
            </DropdownMenuItem>
          ) : null}
          {props.canArchive ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                tone={active ? 'danger' : 'default'}
                onSelect={() => {
                  setStatus(item, active);
                }}
                data-testid={`course-${active ? 'archive' : 'restore'}-${code}`}
              >
                <Icon name={active ? 'archive' : 'archive-restore'} />
                {active ? text('archiveCourse', { code }) : text('restoreCourse', { code })}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const cost = (item: CourseListItem) =>
    item.costSession === null && item.costParticipant === null ? (
      <span className="text-text-muted">{text('notEstimated')}</span>
    ) : (
      <span className="flex flex-col whitespace-nowrap">
        {item.costSession ? <span>{item.costSession}</span> : null}
        {item.costParticipant ? (
          <span className="text-xs text-text-muted">{item.costParticipant}</span>
        ) : null}
      </span>
    );

  const filtered = Boolean(params.q ?? params.category ?? params.type);
  /** The list with the same search and filters, in another status view. */
  const withStatus = (status: string | null): CoursesParams => {
    const { status: _current, ...rest } = params;
    return status ? { ...rest, status } : rest;
  };
  const pill = (
    key: 'category' | 'type',
    label: string,
    allLabel: string,
    options: readonly FilterMenuOption[],
  ) => {
    const value = params[key] ?? null;
    const chosen = options.find((o) => o.value === value);
    return (
      <FilterMenu
        label={label}
        value={chosen ? value : null}
        options={options}
        allLabel={allLabel}
        onChange={(next) => {
          go({ [key]: next ?? undefined });
        }}
        removeLabel={`${label}: ${chosen?.label ?? ''} — ${text('clearFilters')}`}
        data-testid={`courses-filter-${key}`}
      />
    );
  };

  return (
    <>
      <PageHeader
        title={text('title')}
        description={text('description')}
        actions={
          props.canManage ? (
            <Button
              onClick={() => {
                setPanel({ kind: 'add' });
              }}
              data-testid="course-add"
            >
              <Icon name="plus" />
              {text('addCourse')}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-5">
        {props.notices}
        <ViewCards
          label={text('status')}
          current={params.status ?? 'all'}
          items={(['all', 'active', 'archived'] as const).map((key) => ({
            key,
            href: coursesHref(locale, withStatus(key === 'all' ? null : key)),
            label: text(`stats.${key === 'all' ? 'total' : key}`),
            count: key === 'all' ? props.counts.total : props.counts[key],
            testId: `courses-view-${key}`,
          }))}
          className="xl:[&_ul]:grid-cols-3"
          data-testid="courses-stats"
        />
        <div className="flex flex-col gap-2" data-testid="courses-filters">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            <form
              role="search"
              aria-label={text('filtersLabel')}
              onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
                event.preventDefault();
                applySearch(query);
              }}
              className="w-full md:w-auto"
            >
              <ListSearch
                id="courses-q"
                label={text('search')}
                placeholder={text('search')}
                maxLength={100}
                value={query}
                autoComplete="off"
                aria-describedby="courses-q-hint"
                onChange={(event) => {
                  const value = event.target.value;
                  setQuery(value);
                  window.clearTimeout(timer.current);
                  timer.current = window.setTimeout(() => {
                    applySearch(value);
                  }, SEARCH_PAUSE);
                }}
              />
            </form>
            <FilterBar>
              {pill('category', text('category'), text('allCategories'), props.categoryOptions)}
              {pill('type', text('deliveryType'), text('allDeliveryTypes'), props.deliveryOptions)}
              {filtered ? (
                <a
                  href={coursesHref(locale, params.status ? { status: params.status } : {})}
                  className="px-1 text-sm font-semibold"
                  data-testid="courses-clear"
                >
                  {text('clearFilters')}
                </a>
              ) : null}
            </FilterBar>
          </div>
          <p id="courses-q-hint" className="m-0 text-[13px] text-text-muted">
            {text('searchHint')}
          </p>
        </div>

        {props.truncated ? <Alert tone="info">{text('truncated')}</Alert> : null}

        {props.items.length === 0 ? (
          <section
            className="rounded-xl border border-border bg-surface shadow-2"
            data-testid="courses-empty"
          >
            <EmptyState
              icon={filtered ? 'search' : 'courses'}
              title={filtered ? text('emptyFilteredTitle') : text('emptyTitle')}
              description={filtered ? text('emptyFilteredBody') : text('emptyBody')}
              action={
                filtered ? (
                  <a
                    href={coursesHref(locale, params.status ? { status: params.status } : {})}
                    className={buttonClasses({ variant: 'secondary', size: 'md' })}
                  >
                    <Icon name="close" />
                    {text('clearFilters')}
                  </a>
                ) : props.canManage ? (
                  <Button
                    onClick={() => {
                      setPanel({ kind: 'add' });
                    }}
                  >
                    <Icon name="plus" />
                    {text('addCourse')}
                  </Button>
                ) : undefined
              }
            />
          </section>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-2">
            <div className={`${tableClasses.wrapper} hidden md:block`}>
              <table className={tableClasses.table} data-testid="courses-table">
                <caption className="sr-only">{text('tableCaption')}</caption>
                <thead className={tableClasses.header}>
                  <tr>
                    {(
                      [
                        'title',
                        'category',
                        'deliveryType',
                        'duration',
                        'participants',
                        ...(props.canSeeCosts ? (['cost'] as const) : []),
                        'status',
                      ] as const
                    ).map((key) => (
                      <th key={key} scope="col" className={tableClasses.head}>
                        {text(`columns.${key}`)}
                      </th>
                    ))}
                    {showMenu ? (
                      <th scope="col" className={tableClasses.head}>
                        <span className="sr-only">{text('columns.actions')}</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {props.items.map((item) => (
                    <tr
                      key={item.course.id}
                      className={cn(
                        tableClasses.row,
                        item.course.status === 'archived' && 'text-text-muted',
                        viewing?.course.id === item.course.id && 'bg-surface-selected',
                      )}
                      data-testid={`course-row-${item.course.code}`}
                    >
                      <th scope="row" className={`${tableClasses.cell} max-w-xs py-3 text-start`}>
                        <span className="flex flex-col">
                          <bdi dir="ltr" className="font-mono text-[12.5px] text-text-muted">
                            {item.course.code}
                          </bdi>
                          <button
                            type="button"
                            className="w-fit text-start font-semibold hover:underline"
                            onClick={() => {
                              setPanel({ kind: 'view', id: item.course.id });
                            }}
                            data-testid={`course-open-${item.course.code}`}
                          >
                            {item.title}
                          </button>
                          <span
                            className="text-[13px] font-normal text-text-muted"
                            lang={locale === 'ar' ? 'en' : 'ar'}
                            dir="auto"
                          >
                            {item.otherTitle}
                          </span>
                        </span>
                      </th>
                      <td className={tableClasses.cell}>
                        {item.category ?? (
                          <span className="text-text-muted">{text('noCategory')}</span>
                        )}
                      </td>
                      <td className={tableClasses.cell}>
                        <Badge tone="neutral">{item.deliveryType}</Badge>
                      </td>
                      <td className={`${tableClasses.cell} whitespace-nowrap`}>
                        {item.duration}
                        {item.durationDays ? (
                          <span className="text-text-muted"> ({item.durationDays})</span>
                        ) : null}
                      </td>
                      <td className={`${tableClasses.cell} whitespace-nowrap`}>
                        {item.participants}
                      </td>
                      {props.canSeeCosts ? (
                        <td className={tableClasses.cell} data-testid="course-cost">
                          {cost(item)}
                        </td>
                      ) : null}
                      <td className={tableClasses.cell}>{statusBadge(item)}</td>
                      {showMenu ? (
                        <td className={`${tableClasses.cell} text-end`}>{rowMenu(item)}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListCards aria-label={text('tableCaption')} data-testid="courses-cards">
              {props.items.map((item) => (
                <ListCard
                  key={item.course.id}
                  title={
                    <span className="flex flex-col">
                      <bdi
                        dir="ltr"
                        className="font-mono text-[12.5px] font-normal text-text-muted"
                      >
                        {item.course.code}
                      </bdi>
                      <button
                        type="button"
                        className="text-start font-semibold"
                        onClick={() => {
                          setPanel({ kind: 'view', id: item.course.id });
                        }}
                      >
                        {item.title}
                      </button>
                    </span>
                  }
                  detail={
                    <>
                      <span className="block">
                        {item.deliveryType} · {item.duration} · {item.participants}
                      </span>
                      {props.canSeeCosts ? (
                        <span className="block">
                          {item.costSession ?? item.costParticipant ?? text('notEstimated')}
                        </span>
                      ) : null}
                    </>
                  }
                  status={statusBadge(item)}
                  action={showMenu ? rowMenu(item) : undefined}
                />
              ))}
            </ListCards>
          </div>
        )}
      </div>

      <SidePanel
        open={viewing !== null}
        onClose={() => {
          setPanel((current) => (current?.kind === 'view' ? null : current));
        }}
        title={viewing?.title ?? ''}
        description={
          viewing ? (
            <span className="flex flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-2">
                <bdi dir="ltr" className="font-mono text-[13px] font-semibold text-text">
                  {viewing.course.code}
                </bdi>
                {statusBadge(viewing)}
              </span>
              <span lang={locale === 'ar' ? 'en' : 'ar'} dir="auto">
                {viewing.otherTitle}
              </span>
            </span>
          ) : null
        }
        closeLabel={text('form.close')}
        data-testid="course-panel-view"
        footer={
          viewing ? (
            <>
              {props.canArchive ? (
                <Button
                  variant="ghost"
                  className={
                    viewing.course.status === 'active'
                      ? 'text-danger hover:bg-danger-subtle'
                      : undefined
                  }
                  disabled={statusPending}
                  onClick={() => {
                    setStatus(viewing, viewing.course.status === 'active');
                  }}
                  aria-label={
                    viewing.course.status === 'active'
                      ? text('archiveCourse', { code: viewing.course.code })
                      : text('restoreCourse', { code: viewing.course.code })
                  }
                >
                  <Icon name={viewing.course.status === 'active' ? 'archive' : 'archive-restore'} />
                  {viewing.course.status === 'active' ? text('archive') : text('restore')}
                </Button>
              ) : null}
              {props.canManage && viewing.course.status === 'active' ? (
                <Button
                  className="ms-auto"
                  onClick={() => {
                    setPanel({ kind: 'edit', id: viewing.course.id });
                  }}
                  aria-label={text('editCourse', { code: viewing.course.code })}
                  data-testid="course-panel-edit"
                >
                  <Icon name="pencil" />
                  {text('edit')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {viewing ? (
          <>
            {viewing.description ? <p className="m-0">{viewing.description}</p> : null}
            <dl className="m-0 grid grid-cols-2 gap-3">
              {(
                [
                  ['category', viewing.category ?? text('noCategory')],
                  ['deliveryType', viewing.deliveryType],
                  [
                    'duration',
                    `${viewing.duration}${viewing.durationDays ? ` (${viewing.durationDays})` : ''}`,
                  ],
                  ['participants', viewing.participants],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-[14px] border border-border px-3.5 py-3">
                  <dt className="text-[13px] text-text-muted">{text(`columns.${key}`)}</dt>
                  <dd className="m-0 mt-0.5 font-semibold">{value}</dd>
                </div>
              ))}
              {props.canSeeCosts ? (
                <div className="col-span-2 rounded-[14px] border border-border px-3.5 py-3">
                  <dt className="text-[13px] text-text-muted">{text('columns.cost')}</dt>
                  <dd className="m-0 mt-0.5 font-semibold">{cost(viewing)}</dd>
                </div>
              ) : null}
            </dl>
            <p className="m-0 text-sm text-text-muted">{text('form.participantsHint')}</p>
          </>
        ) : null}
      </SidePanel>

      <SidePanel
        open={panel?.kind === 'add' || editing !== null}
        onClose={() => {
          setPanel((current) =>
            current?.kind === 'add' || current?.kind === 'edit' ? null : current,
          );
        }}
        title={editing ? text('form.editTitle') : text('form.addTitle')}
        description={text('form.intro')}
        closeLabel={text('form.close')}
        size="lg"
        data-testid="course-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              className="ms-auto"
              disabled={formPending}
              onClick={() => {
                setPanel(null);
              }}
            >
              {text('form.cancel')}
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              disabled={formPending}
              busy={formPending}
              data-testid="course-save"
            >
              {formPending ? text('form.saving') : text('form.save')}
            </Button>
          </>
        }
      >
        {panel?.kind === 'add' || editing ? (
          <CourseForm
            key={editing ? editing.course.id : 'new'}
            id={FORM_ID}
            course={editing?.course ?? null}
            {...props.form}
            onDone={() => {
              setPanel(null);
            }}
            onPending={setFormPending}
          />
        ) : null}
      </SidePanel>
    </>
  );
}
