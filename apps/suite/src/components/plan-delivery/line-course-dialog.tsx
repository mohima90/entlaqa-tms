'use client';
import type { CourseFromLineDraft } from '@jadarat/tms';
import { createCourseFromLineAction, linkLineCourseAction } from '@jadarat/tms/actions/sessions';
import { Alert, Button, Dialog, Icon, TextField, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useMemo, useRef, useState, useTransition } from 'react';
import {
  type CourseFormField,
  type CourseFormState,
  EMPTY_COURSE_FORM,
  courseFieldErrorKey,
  courseFormFieldOf,
  parseCourseForm,
} from '../../lib/courses-view';
import type { ErrorTexts } from '../auth/error-text';
import { SelectField } from '../select-field';
import { usePlanTexts } from '../training-plan/use-plan-texts';

export interface LibraryCourse {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly deliveryType: string;
  readonly durationHours: number;
}

export interface LineCourseDialogProps {
  readonly locale: 'ar' | 'en';
  readonly line: {
    readonly id: string;
    readonly version: number;
    readonly title: string;
    /** «Q1 · 47 people from Finance, Sales and Human Resources · 3 sessions of 8–20 · SAR 9,000 per session». */
    readonly facts: string;
  };
  /** «Create course» filled in from the line; null: the line has its course (only «Link» is offered). */
  readonly draft: CourseFromLineDraft | null;
  readonly mode: 'create' | 'link';
  readonly canCreate: boolean;
  readonly canLink: boolean;
  /** The organization's default language: its title is required (PO, 12 Nov 2026). */
  readonly nameLanguage: 'ar' | 'en';
  readonly deliveryTypes: readonly { readonly value: string; readonly label: string }[];
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  /** The library's active courses («Link an existing course»). */
  readonly courses: readonly LibraryCourse[];
  /** More courses than listed: search narrows them (the server lists the first ones). */
  readonly truncated: boolean;
  readonly currentCourseId: string | null;
  readonly costsVisible: boolean;
  readonly currency: string;
  /** Where the page goes back to when the popup closes. */
  readonly closeHref: string;
  /** «Save and next line»: the next line without a course (null: none). */
  readonly nextHref: string | null;
  /** Without a database: the popup checks the values but saves nothing. */
  readonly preview: boolean;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

const FORM_ID = 'line-course-form';

/** The line's values as the course form holds them (text as typed). */
function initialState(draft: CourseFromLineDraft | null): CourseFormState {
  if (!draft) return EMPTY_COURSE_FORM;
  const text = (value: number | null) => (value === null ? '' : String(value));
  return {
    ...EMPTY_COURSE_FORM,
    code: '',
    titleEn: draft.titleEn ?? '',
    titleAr: draft.titleAr ?? '',
    deliveryType: draft.deliveryType ?? '',
    durationHours: text(draft.durationHours),
    minParticipants: String(draft.minParticipants),
    maxParticipants: String(draft.maxParticipants),
    estCostPerSession: text(draft.estCostPerSession),
    estCostPerParticipant: text(draft.estCostPerParticipant),
  };
}

/**
 * «A course for «Advanced Excel»» (WP-LD-04, design screen 2; FR-CAT-01 «course from a plan line»): a 672 px popup
 * opened from the line. A switch at the top — **Create a new course** (the library's own «Add course» fields,
 * filled in from the line and tagged «From the plan»; «More» holds the cost per session, the category, the
 * description and the code, given automatically when left empty) or **Link an existing course** (search the
 * library and pick one). «Cancel» · «Save and next line» · «Create course». Opened by its address, so the server
 * has read the library and the line already; closing goes back to the page.
 */
export function LineCourseDialog(props: LineCourseDialogProps) {
  const { locale } = props;
  const texts = usePlanTexts(props.texts, props.errors, locale);
  const { t } = texts;
  const router = useRouter();
  const [mode, setMode] = useState<'create' | 'link'>(
    props.mode === 'link' || !props.draft || !props.canCreate ? 'link' : 'create',
  );
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CourseFormState>(() => initialState(props.draft));
  const [errors, setErrors] = useState<Partial<Record<CourseFormField, string>>>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [more, setMore] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const fromPlan = useMemo(() => initialState(props.draft), [props.draft]);
  // Which button submitted the form: «Create course» closes, «Save and next line» opens the next line.
  const after = useRef<'close' | 'next'>('close');

  const go = (href: string) => {
    setOpen(false);
    router.replace(href, { scroll: false });
  };
  const close = () => {
    if (!pending) go(props.closeHref);
  };
  const set = (field: CourseFormField, value: string) => {
    setState((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const errorOf = (field: CourseFormField) => {
    const code = errors[field];
    return code ? t(`courses.fieldErrors.${courseFieldErrorKey(code)}`) : undefined;
  };
  const tag = (field: CourseFormField) =>
    props.draft && fromPlan[field] !== '' && state[field] === fromPlan[field] ? (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary-text">
        <Icon name="plan" className="size-3.5" />
        {t('courseDialog.fromPlan')}
      </span>
    ) : undefined;

  const refused = (error: Parameters<typeof texts.formMessage>[0]) => {
    if (texts.sessionRefused(error)) return;
    if (error.code === 'VALIDATION_FAILED') {
      const next: Partial<Record<CourseFormField, string>> = {};
      for (const fieldError of error.fieldErrors ?? []) {
        if (fieldError.path === 'courseId') {
          setMessage({ tone: 'danger', text: t('courseDialog.pickAgain') });
          return;
        }
        const field = courseFormFieldOf(fieldError.path.replace(/^course\./, ''));
        if (field) next[field] ??= fieldError.code;
      }
      setErrors(next);
      if (next.code || next.category || next.descriptionEn || next.descriptionAr) setMore(true);
    }
    setMessage({ tone: 'danger', text: texts.formMessage(error) });
  };

  function onCreate(event: SyntheticEvent<HTMLFormElement>, then: 'close' | 'next') {
    event.preventDefault();
    setMessage(null);
    const code = state.code.trim();
    const parsed = parseCourseForm({ ...state, code: code || 'NEW' }, props.nameLanguage);
    if (parsed.errors) {
      setErrors(parsed.errors);
      if (
        parsed.errors.code ||
        parsed.errors.category ||
        parsed.errors.estCostPerSession ||
        parsed.errors.descriptionEn ||
        parsed.errors.descriptionAr
      ) {
        setMore(true);
      }
      setMessage({ tone: 'danger', text: props.errors['errors.validationFailed'] ?? '' });
      return;
    }
    if (props.preview) {
      setMessage({ tone: 'info', text: t('preview') });
      return;
    }
    const values = { ...parsed.values, code: code === '' ? null : code };
    startTransition(async () => {
      const result = await createCourseFromLineAction({
        lineId: props.line.id,
        lineVersion: props.line.version,
        course: values,
      });
      if (!result.ok) {
        if (
          result.error.fieldErrors?.some(
            (e) => e.path === 'course.code' && e.code === 'CODE_TAKEN',
          ) &&
          code === ''
        ) {
          setMessage({ tone: 'danger', text: t('courses.form.codeUnavailable') });
          return;
        }
        refused(result.error);
        return;
      }
      toast.success(t('courseDialog.created', { title: props.line.title }));
      go(then === 'next' && props.nextHref ? props.nextHref : props.closeHref);
    });
  }

  function onLink(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!picked) {
      setMessage({ tone: 'danger', text: t('courseDialog.pickFirst') });
      return;
    }
    if (props.preview) {
      setMessage({ tone: 'info', text: t('preview') });
      return;
    }
    const course = props.courses.find((c) => c.id === picked);
    startTransition(async () => {
      const result = await linkLineCourseAction({
        lineId: props.line.id,
        lineVersion: props.line.version,
        courseId: picked,
      });
      if (!result.ok) {
        refused(result.error);
        return;
      }
      toast.success(t('courseDialog.linked', { title: course?.title ?? '' }));
      go(props.closeHref);
    });
  }

  const needle = search.trim().toLocaleLowerCase();
  const listed = props.courses.filter(
    (c) =>
      needle === '' ||
      c.title.toLocaleLowerCase().includes(needle) ||
      c.code.toLocaleLowerCase().includes(needle),
  );
  const nameOrder: readonly ('ar' | 'en')[] =
    props.nameLanguage === 'ar' ? ['ar', 'en'] : ['en', 'ar'];
  const switchable = props.canCreate && props.canLink && props.draft !== null;

  const footer =
    mode === 'create' ? (
      <>
        <Button
          variant="secondary"
          onClick={close}
          disabled={pending}
          data-testid="line-course-cancel"
        >
          {t('courseDialog.cancel')}
        </Button>
        {props.nextHref ? (
          <Button
            type="submit"
            form={FORM_ID}
            variant="secondary"
            disabled={pending}
            onClick={() => {
              after.current = 'next';
            }}
            data-testid="line-course-save-next"
          >
            {t('courseDialog.saveNext')}
          </Button>
        ) : null}
        <Button
          type="submit"
          form={FORM_ID}
          disabled={pending}
          busy={pending}
          onClick={() => {
            after.current = 'close';
          }}
          data-testid="line-course-create"
        >
          <Icon name="check" className="size-4" />
          {pending ? t('courseDialog.creating') : t('courseDialog.create')}
        </Button>
      </>
    ) : (
      <>
        <Button
          variant="secondary"
          onClick={close}
          disabled={pending}
          data-testid="line-course-cancel"
        >
          {t('courseDialog.cancel')}
        </Button>
        <Button
          type="submit"
          form={FORM_ID}
          disabled={pending || props.courses.length === 0}
          busy={pending}
          data-testid="line-course-link"
        >
          {pending ? t('courseDialog.linking') : t('courseDialog.linkButton')}
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onClose={close}
      canClose={() => !pending}
      size="rich"
      title={t('courseDialog.title', { title: props.line.title })}
      description={mode === 'create' ? t('courseDialog.intro') : t('courseDialog.introLink')}
      closeLabel={t('close')}
      footer={footer}
      data-testid="line-course-dialog"
    >
      {switchable ? (
        <div
          role="group"
          aria-label={t('courseDialog.modes')}
          className="inline-flex w-fit flex-wrap items-center gap-1 rounded-full bg-surface-hover p-1"
        >
          {(['create', 'link'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => {
                setMode(key);
                setMessage(null);
              }}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold pointer-coarse:min-h-11',
                mode === key ? 'bg-surface text-text shadow-1' : 'text-text-muted hover:text-text',
              )}
              data-testid={`line-course-mode-${key}`}
            >
              <Icon name={key === 'create' ? 'plus' : 'copy'} className="size-4" />
              {t(`courseDialog.mode.${key}`)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-sunken p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-text">
          <Icon name="plan" className="size-5" />
        </span>
        <p className="m-0 flex flex-col gap-0.5 text-sm">
          <b className="text-[15px]">{t('courseDialog.lineBox', { title: props.line.title })}</b>
          <span className="text-text-muted">{props.line.facts}</span>
        </p>
      </div>
      {message ? (
        <Alert tone={message.tone} data-testid="line-course-message">
          {message.text}
        </Alert>
      ) : null}

      {mode === 'create' ? (
        <form
          id={FORM_ID}
          noValidate
          onSubmit={(event) => {
            onCreate(event, after.current);
            after.current = 'close';
          }}
          className="flex flex-col gap-4"
          data-testid="line-course-form"
        >
          {nameOrder.map((language) => {
            const field = language === 'ar' ? 'titleAr' : 'titleEn';
            const required = language === props.nameLanguage;
            return (
              <TextField
                key={field}
                id={`line-course-${field}`}
                label={t(`courses.form.${field}`)}
                marker={required ? t('required') : t('optional')}
                required={required}
                value={state[field]}
                onChange={(event) => {
                  set(field, event.target.value);
                }}
                maxLength={200}
                dir={language === 'ar' ? 'rtl' : 'ltr'}
                lang={language}
                autoComplete="off"
                hint={required ? tag(field) : t('courseDialog.otherLanguage')}
                error={errorOf(field)}
                disabled={pending}
                data-testid={`line-course-${field}`}
              />
            );
          })}
          <SelectField
            id="line-course-deliveryType"
            label={t('courses.form.deliveryType')}
            marker={t('required')}
            aria-required
            tag={tag('deliveryType')}
            value={state.deliveryType}
            onChange={(event) => {
              set('deliveryType', event.target.value);
            }}
            error={errorOf('deliveryType')}
            disabled={pending}
            data-testid="line-course-deliveryType"
          >
            {state.deliveryType === '' ? (
              <option value="">{t('courseDialog.choose')}</option>
            ) : null}
            {props.deliveryTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </SelectField>
          <TextField
            id="line-course-durationHours"
            label={t('courses.form.durationHours')}
            marker={t('required')}
            required
            value={state.durationHours}
            onChange={(event) => {
              set('durationHours', event.target.value);
            }}
            inputMode="decimal"
            autoComplete="off"
            className="max-w-60"
            hint={tag('durationHours')}
            error={errorOf('durationHours')}
            disabled={pending}
            data-testid="line-course-durationHours"
          />
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-sm font-semibold">
              {t('courseDialog.participants')}
              <span aria-hidden="true" className="ms-1 text-danger">
                *
              </span>
              <span className="sr-only"> {t('required')}</span>
            </legend>
            <div className="flex flex-wrap items-start gap-3">
              <TextField
                id="line-course-minParticipants"
                label={t('courseDialog.from')}
                aria-required
                value={state.minParticipants}
                onChange={(event) => {
                  set('minParticipants', event.target.value);
                }}
                inputMode="numeric"
                autoComplete="off"
                className="w-28"
                error={errorOf('minParticipants')}
                disabled={pending}
                data-testid="line-course-min"
              />
              <TextField
                id="line-course-maxParticipants"
                label={t('courseDialog.to')}
                aria-required
                value={state.maxParticipants}
                onChange={(event) => {
                  set('maxParticipants', event.target.value);
                }}
                inputMode="numeric"
                autoComplete="off"
                className="w-28"
                error={errorOf('maxParticipants')}
                disabled={pending}
                data-testid="line-course-max"
              />
            </div>
            {tag('maxParticipants') ? <p className="m-0">{tag('maxParticipants')}</p> : null}
          </fieldset>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={more}
              aria-controls="line-course-more"
              onClick={() => {
                setMore((value) => !value);
              }}
              className="inline-flex w-fit items-center gap-1.5 rounded-sm font-semibold text-primary-text"
              data-testid="line-course-more"
            >
              {t('courseDialog.more')}
              <Icon name={more ? 'chevron-up' : 'chevron-down'} className="size-4" />
              <span className="font-normal text-text-muted">· {t('courseDialog.moreHint')}</span>
            </button>
            <div id="line-course-more" hidden={!more} className="flex flex-col gap-4">
              {props.costsVisible ? (
                <TextField
                  id="line-course-estCostPerSession"
                  label={t('courses.form.estCostPerSession', { currency: props.currency })}
                  marker={t('optional')}
                  value={state.estCostPerSession}
                  onChange={(event) => {
                    set('estCostPerSession', event.target.value);
                  }}
                  inputMode="decimal"
                  autoComplete="off"
                  className="max-w-60"
                  hint={tag('estCostPerSession')}
                  error={errorOf('estCostPerSession')}
                  disabled={pending}
                />
              ) : null}
              <SelectField
                id="line-course-category"
                label={t('courses.form.category')}
                marker={t('optional')}
                value={state.category}
                onChange={(event) => {
                  set('category', event.target.value);
                }}
                error={errorOf('category')}
                disabled={pending}
              >
                <option value="">{t('courses.form.categoryNone')}</option>
                {props.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </SelectField>
              <TextField
                id={`line-course-description${props.nameLanguage === 'ar' ? 'Ar' : 'En'}`}
                label={t(`courses.form.description${props.nameLanguage === 'ar' ? 'Ar' : 'En'}`)}
                marker={t('optional')}
                value={props.nameLanguage === 'ar' ? state.descriptionAr : state.descriptionEn}
                onChange={(event) => {
                  set(
                    props.nameLanguage === 'ar' ? 'descriptionAr' : 'descriptionEn',
                    event.target.value,
                  );
                }}
                maxLength={2000}
                autoComplete="off"
                error={errorOf(props.nameLanguage === 'ar' ? 'descriptionAr' : 'descriptionEn')}
                disabled={pending}
              />
              <TextField
                id="line-course-code"
                label={t('courses.form.code')}
                marker={t('optional')}
                value={state.code}
                onChange={(event) => {
                  set('code', event.target.value);
                }}
                maxLength={32}
                dir="ltr"
                autoComplete="off"
                className="max-w-72"
                hint={t('courseDialog.codeHint')}
                error={errorOf('code')}
                disabled={pending}
                data-testid="line-course-code"
              />
            </div>
          </div>
        </form>
      ) : (
        <form
          id={FORM_ID}
          noValidate
          onSubmit={onLink}
          className="flex flex-col gap-3"
          data-testid="line-course-link-form"
        >
          <TextField
            id="line-course-search"
            type="search"
            label={t('courseDialog.search')}
            placeholder={t('courseDialog.searchPlaceholder')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            autoComplete="off"
            disabled={pending}
            data-testid="line-course-search"
          />
          {props.truncated ? (
            <p className="m-0 text-sm text-text-muted">{t('courseDialog.tooMany')}</p>
          ) : null}
          {props.courses.length === 0 ? (
            <p className="m-0 text-text-muted">{t('courseDialog.noCourses')}</p>
          ) : (
            <fieldset className="m-0 border-0 p-0">
              <legend className="sr-only">{t('courseDialog.pick')}</legend>
              {listed.length === 0 ? (
                <p className="m-0 text-text-muted" aria-live="polite">
                  {t('courseDialog.noMatch')}
                </p>
              ) : (
                <ul className="m-0 flex max-h-80 list-none flex-col gap-2 overflow-y-auto p-0">
                  {listed.map((course) => (
                    <li key={course.id}>
                      <div
                        className={cn(
                          'flex min-h-12 items-start gap-3 rounded-lg border px-3.5 py-2.5',
                          picked === course.id
                            ? 'border-primary bg-primary-subtle'
                            : 'border-border hover:bg-surface-hover',
                        )}
                        data-testid="line-course-option"
                      >
                        <input
                          id={`line-course-option-${course.id}`}
                          type="radio"
                          name="courseId"
                          value={course.id}
                          checked={picked === course.id}
                          aria-describedby={`line-course-facts-${course.id}`}
                          onChange={() => {
                            setPicked(course.id);
                            setMessage(null);
                          }}
                          disabled={pending}
                          className="mt-1 size-4 accent-primary"
                        />
                        <span className="flex min-w-0 flex-col">
                          <label
                            htmlFor={`line-course-option-${course.id}`}
                            className="cursor-pointer font-semibold"
                          >
                            {course.title}
                          </label>
                          <span
                            id={`line-course-facts-${course.id}`}
                            className="text-sm text-text-muted"
                          >
                            {t('courseDialog.courseFacts', {
                              code: course.code,
                              type: t(`deliveryTypes.${course.deliveryType}`),
                              hours: course.durationHours,
                            })}
                            {course.id === props.currentCourseId
                              ? ` · ${t('courseDialog.current')}`
                              : ''}
                          </span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}
          <p className="m-0 text-sm text-text-muted">{t('courseDialog.linkNote')}</p>
        </form>
      )}
    </Dialog>
  );
}
