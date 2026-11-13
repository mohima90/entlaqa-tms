'use client';
import type { CourseRow } from '@jadarat/tms/courses';
import { Alert, Card, FieldError, FieldMarker, SaveBar, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useEffect, useState, useTransition } from 'react';
import { updateCourseAction } from '../../actions/courses';
import {
  type CourseFormErrors,
  type CourseFormField,
  type CourseFormState,
  type CourseSettingsTab,
  courseFieldErrorKey,
  courseFieldTab,
  courseFormFieldOf,
  courseFormFrom,
  parseCourseForm,
} from '../../lib/courses-view';
import { nameOrder } from '../../lib/structure-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { LoadLatestVersion, useFormBase, useLatestVersion } from '../latest-version';
import { SelectField } from '../select-field';
import { LeaveGuard } from '../settings/leave-guard';

export interface CourseSettingsFormProps {
  /** The section that is open (each section is its own address, `?tab=`). */
  readonly tab: CourseSettingsTab;
  readonly course: CourseRow;
  /** The organization's categories, named in the page's language. */
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  /** Delivery types in list order, with their names. */
  readonly deliveryTypes: readonly { readonly value: string; readonly label: string }[];
  /** Every type's label: a course on a type no longer offered keeps it in the list (PO, 27 Oct 2026). */
  readonly deliveryTypeLabels: Readonly<Record<string, string>>;
  /** The organization's default currency (General settings): the currency new costs are entered in. */
  readonly currency: string;
  /** Show the cost fields (holders of tms.course_cost.read). */
  readonly showCosts: boolean;
  /** The language whose title is required: the organization's default language (PO, 12 Nov 2026). */
  readonly nameLanguage: 'ar' | 'en';
  /** Without a database: the form checks the values but saves nothing. */
  readonly preview: boolean;
  /**
   * The `courses` messages, raw, by dotted key; plus `required`, `optional` and the save bar's and the
   * leave question's words (`unsavedChanges`, `discardChanges`, `leaveTitle`, `leaveText`, `leaveStay`,
   * `leaveGo`).
   */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

const FORM_ID = 'course-settings';
const TEXTAREA =
  'min-h-20 w-full rounded-md border-[1.5px] bg-surface px-3.5 py-2.5 text-[15px] text-text placeholder:text-text-subtle disabled:cursor-not-allowed disabled:bg-surface-sunken';
const same = (a: CourseFormState, b: CourseFormState) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A course's Settings page (the Kawadir pattern — forms standard rule 9; WP-UX-01 c, T-M3-21; FR-CAT-01):
 * everything «Add course» does not ask, on the course's own page — «About the course», «Delivery and
 * duration», «Participants and cost» as tabs at the side, each its own address, and one save bar for the
 * section that is open. The fields, their checks and what is saved are the former course form's: the whole
 * course is sent with its version (ADR 0011) — the open section's fields as typed, the others as stored.
 * An older copy is refused and «Load the latest version» is offered; typed entries are never replaced by a
 * newer copy (`useFormBase`). Leaving the section with unsaved changes asks first.
 */
export function CourseSettingsForm(props: CourseSettingsFormProps) {
  const { texts, course } = props;
  const text = (key: string, params: Record<string, string> = {}) => {
    let value = texts[key] ?? key;
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${name}}`, replacement);
    }
    return value;
  };
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const latestVersion = useLatestVersion();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CourseFormState>(() => courseFormFrom(course));
  const [errors, setErrors] = useState<CourseFormErrors>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  // What the last save wrote counts as saved at the version it returned, until the page has loaded that
  // version itself (the form stays on the page after saving).
  const [saved, setSaved] = useState<CourseRow | null>(null);
  // The fields and the version they were read at stay together (second look L6): if the page reloads under
  // the form, an untouched form takes the latest course, a form with typed changes keeps the version it
  // started from and is refused as a conflict.
  const base = useFormBase(
    { version: course.version, initial: course },
    (initial) => !same(state, courseFormFrom(saved ?? initial)),
    (latest) => {
      setSaved(null);
      setState(courseFormFrom(latest));
      setErrors({});
    },
  );
  const stored = saved ?? base.initial;
  const dirty = base.dirty;
  const idPrefix = `course-${course.id}`;

  // Said to the page: it does not reload itself over unsaved entries (RefreshOnReturn, WP-FIX-03).
  useEffect(() => {
    if (dirty) document.body.dataset.unsaved = 'true';
    else delete document.body.dataset.unsaved;
    return () => {
      delete document.body.dataset.unsaved;
    };
  }, [dirty]);

  const set = (field: CourseFormField) => (value: string) => {
    setState((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const errorOf = (field: CourseFormField) => {
    const code = errors[field];
    return code ? text(`fieldErrors.${courseFieldErrorKey(code)}`) : undefined;
  };
  const required = texts.required ?? '';
  const optional = texts.optional ?? '';

  /** A refused field of another section is said in words: its section's name and the field's message. */
  const elsewhere = (found: CourseFormErrors): string | null => {
    const field = (Object.keys(found) as CourseFormField[]).find(
      (key) => found[key] !== undefined && courseFieldTab(key) !== props.tab,
    );
    if (!field) return null;
    const section = {
      about: 'sectionAbout',
      delivery: 'sectionDelivery',
      capacity: 'sectionCapacity',
    };
    return `${text(`form.${section[courseFieldTab(field)]}`)}: ${text(
      `fieldErrors.${courseFieldErrorKey(found[field] ?? '')}`,
    )}`;
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = parseCourseForm(
      props.showCosts ? state : { ...state, estCostPerSession: '', estCostPerParticipant: '' },
      props.nameLanguage,
      stored,
    );
    if (parsed.errors) {
      setErrors(parsed.errors);
      setMessage({
        tone: 'danger',
        text: elsewhere(parsed.errors) ?? props.errors['errors.validationFailed'] ?? '',
      });
      return;
    }
    if (props.preview) {
      setMessage({ tone: 'info', text: text('previewNotSaved') });
      return;
    }
    const values = parsed.values;
    startTransition(async () => {
      const result = await updateCourseAction({
        ...values,
        id: course.id,
        version: saved?.version ?? base.version,
      });
      if (result.ok) {
        // A category created with the save is now one of the organization's: the form points at it.
        const after = result.value.after;
        setSaved(after);
        setState(courseFormFrom(after));
        setErrors({});
        toast.success(text('saved'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      // An older copy of the course (WP-FIX-03): what was typed stays; «Load the latest version» is offered.
      const latest = latestVersion.offer(result.error, text('conflict'));
      if (latest !== null) {
        setMessage({ tone: 'danger', text: latest });
        return;
      }
      if (result.error.code === 'NOT_FOUND') {
        setMessage({ tone: 'danger', text: text('notFound') });
        return;
      }
      const next: CourseFormErrors = {};
      if (result.error.code === 'VALIDATION_FAILED') {
        for (const fieldError of result.error.fieldErrors ?? []) {
          const field = courseFormFieldOf(fieldError.path);
          if (field) next[field] ??= fieldError.code;
        }
        setErrors(next);
      }
      setMessage({
        tone: 'danger',
        text: elsewhere(next) ?? errorText(result.error, props.errors),
      });
    });
  }

  const field = (
    name: CourseFormField,
    options: {
      readonly label: string;
      readonly required?: boolean;
      readonly hint?: string;
      readonly ltr?: boolean;
      readonly numeric?: boolean;
      readonly lang?: string;
    },
  ) => (
    <TextField
      key={name}
      id={`${idPrefix}-${name}`}
      label={options.label}
      marker={options.required ? required : optional}
      hint={options.hint}
      error={errorOf(name)}
      value={state[name]}
      onChange={(event) => {
        set(name)(event.target.value);
      }}
      disabled={pending}
      required={options.required}
      dir={options.ltr ? 'ltr' : options.lang === 'ar' ? 'rtl' : undefined}
      lang={options.lang}
      inputMode={options.numeric ? 'decimal' : undefined}
      autoComplete="off"
      data-testid={`course-field-${name}`}
    />
  );

  const textarea = (name: 'descriptionEn' | 'descriptionAr', label: string, lang: string) => {
    const id = `${idPrefix}-${name}`;
    const error = errorOf(name);
    return (
      <div key={name} className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
          <FieldMarker marker={optional} required={false} />
        </label>
        <textarea
          id={id}
          value={state[name]}
          onChange={(event) => {
            set(name)(event.target.value);
          }}
          lang={lang}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          rows={3}
          maxLength={2000}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${TEXTAREA} ${error ? 'border-danger' : 'border-border-strong'}`}
          data-testid={`course-field-${name}`}
        />
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </div>
    );
  };

  /**
   * The two fields of a bilingual text: the default language first (required), the other optional — side by
   * side from 600 px, as in the popups (the two language names are a short natural pair).
   */
  const pair = (
    fields: { readonly en: CourseFormField; readonly ar: CourseFormField },
    labels: { readonly en: string; readonly ar: string },
    requiredNow: boolean,
  ) => (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
      {nameOrder(props.nameLanguage).map((language) =>
        field(fields[language], {
          label: labels[language],
          required: requiredNow && language === props.nameLanguage,
          lang: language,
          ltr: language === 'en',
        }),
      )}
    </div>
  );

  // A course titled before the rule — or before the organization changed its default language — may have
  // no title in today's default language: the asterisk shows only where a title is asked now.
  const titleRequired =
    (props.nameLanguage === 'ar' ? stored.titleAr : stored.titleEn) !== null ||
    state.titleEn !== (stored.titleEn ?? '') ||
    state.titleAr !== (stored.titleAr ?? '');

  let section: ReactNode;
  if (props.tab === 'about') {
    section = (
      <Card
        title={text('form.sectionAbout')}
        description={text('settings.aboutIntro')}
        headingLevel={2}
      >
        <div className="flex flex-col gap-4">
          {field('code', {
            label: text('form.code'),
            required: true,
            hint: text('form.codeHint'),
            ltr: true,
          })}
          {pair(
            { en: 'titleEn', ar: 'titleAr' },
            { en: text('form.titleEn'), ar: text('form.titleAr') },
            titleRequired,
          )}
          {nameOrder(props.nameLanguage).map((language) =>
            language === 'ar'
              ? textarea('descriptionAr', text('form.descriptionAr'), 'ar')
              : textarea('descriptionEn', text('form.descriptionEn'), 'en'),
          )}
          <SelectField
            id={`${idPrefix}-category`}
            label={text('form.category')}
            marker={optional}
            error={errorOf('category')}
            value={state.category}
            onChange={(event) => {
              set('category')(event.target.value);
            }}
            disabled={pending}
            data-testid="course-field-category"
          >
            <option value="">{text('form.categoryNone')}</option>
            {props.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
            <option value="new">{text('form.categoryNew')}</option>
          </SelectField>
          {state.category === 'new'
            ? pair(
                { en: 'newCategoryEn', ar: 'newCategoryAr' },
                { en: text('form.newCategoryEn'), ar: text('form.newCategoryAr') },
                true,
              )
            : null}
        </div>
      </Card>
    );
  } else if (props.tab === 'delivery') {
    section = (
      <Card
        title={text('form.sectionDelivery')}
        description={text('settings.deliveryIntro')}
        headingLevel={2}
      >
        <div className="flex flex-col gap-4">
          <SelectField
            id={`${idPrefix}-deliveryType`}
            label={text('form.deliveryType')}
            marker={required}
            aria-required
            error={errorOf('deliveryType')}
            value={state.deliveryType}
            onChange={(event) => {
              set('deliveryType')(event.target.value);
            }}
            disabled={pending}
            data-testid="course-field-deliveryType"
          >
            {[
              ...props.deliveryTypes,
              ...(state.deliveryType &&
              !props.deliveryTypes.some((type) => type.value === state.deliveryType)
                ? [
                    {
                      value: state.deliveryType,
                      label: props.deliveryTypeLabels[state.deliveryType] ?? state.deliveryType,
                    },
                  ]
                : []),
            ].map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </SelectField>
          {field('durationHours', {
            label: text('form.durationHours'),
            required: true,
            numeric: true,
          })}
          {field('durationDays', {
            label: text('form.durationDays'),
            hint: text('form.durationDaysHint'),
            numeric: true,
          })}
        </div>
      </Card>
    );
  } else {
    section = (
      <Card
        title={text('form.sectionCapacity')}
        description={text('settings.capacityIntro')}
        headingLevel={2}
      >
        <div className="flex flex-col gap-4">
          {field('minParticipants', {
            label: text('form.minParticipants'),
            required: true,
            numeric: true,
          })}
          {field('maxParticipants', {
            label: text('form.maxParticipants'),
            required: true,
            numeric: true,
          })}
          <p className="m-0 text-[13.5px] text-text-muted">{text('form.participantsHint')}</p>
          {props.showCosts ? (
            <>
              {field('estCostPerSession', {
                label: text('form.estCostPerSession', { currency: props.currency }),
                numeric: true,
                ltr: true,
              })}
              {field('estCostPerParticipant', {
                label: text('form.estCostPerParticipant', { currency: props.currency }),
                numeric: true,
                ltr: true,
              })}
              <p className="m-0 text-[13.5px] text-text-muted">{text('form.costHint')}</p>
            </>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <form
      id={FORM_ID}
      className="flex min-w-0 flex-col gap-4"
      onSubmit={onSubmit}
      onReset={(event) => {
        // The save bar's «Discard changes»: back to the stored course (not the browser's reset).
        event.preventDefault();
        setState(courseFormFrom(stored));
        setErrors({});
        setMessage(null);
      }}
      noValidate
      data-testid="course-form"
    >
      {message ? (
        <Alert tone={message.tone} data-testid="course-form-message">
          {message.text}
          <LoadLatestVersion message={message.text} />
        </Alert>
      ) : null}
      {section}
      {dirty || pending ? (
        <SaveBar
          state={pending ? 'saving' : 'unsaved'}
          form={FORM_ID}
          texts={{
            unsaved: text('unsavedChanges'),
            saving: text('form.saving'),
            saved: '',
            save: text('form.save'),
            cancel: text('discardChanges'),
          }}
        />
      ) : null}
      <LeaveGuard
        active={dirty && !pending}
        texts={{
          leaveTitle: text('leaveTitle'),
          leaveText: text('leaveText'),
          leaveStay: text('leaveStay'),
          leaveGo: text('leaveGo'),
          close: text('form.close'),
        }}
      />
    </form>
  );
}
