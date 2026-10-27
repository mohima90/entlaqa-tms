'use client';
import type { CourseRow } from '@jadarat/tms/courses';
import { Alert, FieldError, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useEffect, useState, useTransition } from 'react';
import { createCourseAction, updateCourseAction } from '../../actions/courses';
import {
  type CourseFormErrors,
  type CourseFormField,
  type CourseFormState,
  EMPTY_COURSE_FORM,
  courseFieldErrorKey,
  courseFormFieldOf,
  courseFormFrom,
  parseCourseForm,
} from '../../lib/courses-view';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';

export interface CourseFormSharedProps {
  /** The organization's categories, named in the page's language. */
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  /** Delivery types in list order, with their names. */
  readonly deliveryTypes: readonly { readonly value: string; readonly label: string }[];
  /** Every type's label: a course on a type no longer offered keeps it in the list (PO, 27 Oct 2026). */
  readonly deliveryTypeLabels?: Readonly<Record<string, string>> | undefined;
  /** The organization's default currency (General settings): the currency new costs are entered in. */
  readonly currency: string;
  /** Show the cost fields (holders of tms.course_cost.read). */
  readonly showCosts: boolean;
  /** Without a database: the form checks the values but saves nothing. */
  readonly preview: boolean;
  /** The `courses` messages, raw, by dotted key; plus `required` and `optional`. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

export interface CourseFormProps extends CourseFormSharedProps {
  /** The form's id (the side panel's Save button submits it from the panel's footer). */
  readonly id: string;
  /** The course to edit, or none to add one. */
  readonly course: CourseRow | null;
  readonly onDone: () => void;
  readonly onPending: (pending: boolean) => void;
}

const TEXTAREA =
  'min-h-20 w-full rounded-md border-[1.5px] bg-surface px-3.5 py-2.5 text-[15px] text-text placeholder:text-text-subtle';

/**
 * Add or edit a course (T-M3-03, FR-CAT-01; redesign package 4: in a side panel, in three groups — About the
 * course · Delivery and duration · Participants and cost; «New category…» opens two fields inline). The
 * values are checked here like on the server, then saved through the server action (tms.course.manage);
 * success closes the panel with a toast and refreshes the list.
 */
export function CourseForm(props: CourseFormProps) {
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
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CourseFormState>(
    course ? courseFormFrom(course) : EMPTY_COURSE_FORM,
  );
  const [errors, setErrors] = useState<CourseFormErrors>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const idPrefix = `course-${course ? course.id : 'new'}`;
  const { onPending } = props;
  useEffect(() => {
    onPending(pending);
  }, [pending, onPending]);

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

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = parseCourseForm(
      props.showCosts ? state : { ...state, estCostPerSession: '', estCostPerParticipant: '' },
    );
    if (parsed.errors) {
      setErrors(parsed.errors);
      setMessage({ tone: 'danger', text: props.errors['errors.validationFailed'] ?? '' });
      return;
    }
    if (props.preview) {
      setMessage({ tone: 'info', text: text('previewNotSaved') });
      return;
    }
    const values = parsed.values;
    startTransition(async () => {
      const result = course
        ? await updateCourseAction({ ...values, id: course.id, version: course.version })
        : await createCourseAction(values);
      if (result.ok) {
        toast.success(course ? text('saved') : text('created'));
        props.onDone();
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'CONFLICT_VERSION') {
        setMessage({ tone: 'danger', text: text('conflict') });
        return;
      }
      if (result.error.code === 'NOT_FOUND') {
        setMessage({ tone: 'danger', text: text('notFound') });
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const next: CourseFormErrors = {};
        for (const fieldError of result.error.fieldErrors ?? []) {
          const field = courseFormFieldOf(fieldError.path);
          if (field) next[field] ??= fieldError.code;
        }
        setErrors(next);
      }
      setMessage({ tone: 'danger', text: errorText(result.error, props.errors) });
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
      readonly wide?: boolean;
    },
  ) => (
    <TextField
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
      dir={options.ltr ? 'ltr' : undefined}
      lang={options.lang}
      inputMode={options.numeric ? 'decimal' : undefined}
      autoComplete="off"
      className={undefined}
      data-testid={`course-field-${name}`}
    />
  );

  const textarea = (name: 'descriptionEn' | 'descriptionAr', label: string, lang: string) => {
    const id = `${idPrefix}-${name}`;
    const error = errorOf(name);
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
          <span className="ms-1 font-normal text-text-subtle">{optional}</span>
        </label>
        <textarea
          id={id}
          value={state[name]}
          onChange={(event) => {
            set(name)(event.target.value);
          }}
          lang={lang}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          rows={2}
          maxLength={2000}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${TEXTAREA} ${error ? 'border-danger' : 'border-border-strong'}`}
        />
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </div>
    );
  };

  const group = (legend: string, children: ReactNode) => (
    <fieldset className="m-0 grid min-w-0 grid-cols-1 gap-4 border-0 border-t border-border p-0 pt-4 first-of-type:border-t-0 first-of-type:pt-0">
      <legend className="float-start mb-1 w-full p-0 text-[15px] font-bold">{legend}</legend>
      {children}
    </fieldset>
  );

  return (
    <form
      id={props.id}
      className="flex flex-col gap-5"
      onSubmit={onSubmit}
      noValidate
      data-testid="course-form"
    >
      {message ? (
        <Alert tone={message.tone} data-testid="course-form-message">
          {message.text}
        </Alert>
      ) : null}
      {group(
        text('form.sectionAbout'),
        <>
          {field('code', {
            label: text('form.code'),
            required: true,
            hint: text('form.codeHint'),
            ltr: true,
            wide: true,
          })}
          {field('titleEn', {
            label: text('form.titleEn'),
            required: true,
            lang: 'en',
            ltr: true,
          })}
          {field('titleAr', { label: text('form.titleAr'), required: true, lang: 'ar' })}
          {textarea('descriptionEn', text('form.descriptionEn'), 'en')}
          {textarea('descriptionAr', text('form.descriptionAr'), 'ar')}
          <div className="">
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
          </div>
          {state.category === 'new' ? (
            <>
              {field('newCategoryEn', {
                label: text('form.newCategoryEn'),
                required: true,
                lang: 'en',
                ltr: true,
              })}
              {field('newCategoryAr', {
                label: text('form.newCategoryAr'),
                required: true,
                lang: 'ar',
              })}
            </>
          ) : null}
        </>,
      )}
      {group(
        text('form.sectionDelivery'),
        <>
          <div className="">
            <SelectField
              id={`${idPrefix}-deliveryType`}
              label={text('form.deliveryType')}
              marker={required}
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
                        label: props.deliveryTypeLabels?.[state.deliveryType] ?? state.deliveryType,
                      },
                    ]
                  : []),
              ].map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </SelectField>
          </div>
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
        </>,
      )}
      {group(
        text('form.sectionCapacity'),
        <>
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
        </>,
      )}
    </form>
  );
}
