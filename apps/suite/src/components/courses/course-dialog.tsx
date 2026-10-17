'use client';
import type { CourseRow } from '@jadarat/tms/courses';
import { Alert, Button, Dialog, Icon, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
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

export interface CourseDialogProps {
  /** `create`: the «Add course» button; `edit`: the pencil of a row. */
  readonly mode: 'create' | 'edit';
  readonly course?: CourseRow;
  /** The organization's categories, named in the page's language. */
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  /** Delivery types in list order, with their names. */
  readonly deliveryTypes: readonly { readonly value: string; readonly label: string }[];
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

const TEXTAREA =
  'min-h-20 w-full rounded-2xl border bg-surface px-4 py-2 text-sm text-text shadow-1 placeholder:text-text-subtle';

/**
 * Add or edit a course (T-M3-03, FR-CAT-01) in a dialog (Kawadir: short forms in dialogs). The values are
 * checked here like on the server, then saved through the server action (tms.course.manage); success
 * closes the dialog with a toast and refreshes the list.
 */
export function CourseDialog(props: CourseDialogProps) {
  const { texts } = props;
  const text = (key: string, params: Record<string, string> = {}) => {
    let value = texts[key] ?? key;
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${name}}`, replacement);
    }
    return value;
  };
  const [open, setOpen] = useState(false);
  const editing = props.mode === 'edit' && props.course;
  return (
    <>
      {editing ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          aria-label={text('editCourse', { code: editing.code })}
          data-testid={`course-edit-${editing.code}`}
        >
          <Icon name="pencil" />
        </button>
      ) : (
        <Button
          onClick={() => {
            setOpen(true);
          }}
          data-testid="course-add"
        >
          <Icon name="plus" />
          {text('addCourse')}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={editing ? text('form.editTitle') : text('form.addTitle')}
        description={text('form.intro')}
        closeLabel={text('form.close')}
        size="lg"
        data-testid="course-dialog"
      >
        {open ? (
          <CourseForm
            {...props}
            text={text}
            onDone={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function CourseForm(
  props: CourseDialogProps & {
    readonly text: (key: string, params?: Record<string, string>) => string;
    readonly onDone: () => void;
  },
) {
  const { text, course } = props;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CourseFormState>(
    props.mode === 'edit' && course ? courseFormFrom(course) : EMPTY_COURSE_FORM,
  );
  const [errors, setErrors] = useState<CourseFormErrors>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const idPrefix = `course-${props.mode === 'edit' && course ? course.id : 'new'}`;

  const set = (field: CourseFormField) => (value: string) => {
    setState((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const errorOf = (field: CourseFormField) => {
    const code = errors[field];
    return code ? text(`fieldErrors.${courseFieldErrorKey(code)}`) : undefined;
  };
  const required = texts(props, 'required');
  const optional = texts(props, 'optional');

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
      const result =
        props.mode === 'edit' && course
          ? await updateCourseAction({ ...values, id: course.id, version: course.version })
          : await createCourseAction(values);
      if (result.ok) {
        toast.success(props.mode === 'edit' ? text('saved') : text('created'));
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
      data-testid={`course-field-${name}`}
    />
  );

  const textarea = (name: 'descriptionEn' | 'descriptionAr', label: string, lang: string) => {
    const id = `${idPrefix}-${name}`;
    const error = errorOf(name);
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          <span className="ms-1 font-normal text-text-muted">{optional}</span>
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
        {error ? (
          <p id={`${id}-error`} className="m-0 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate data-testid="course-form">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('code', {
          label: text('form.code'),
          required: true,
          hint: text('form.codeHint'),
          ltr: true,
        })}
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
          {props.deliveryTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </SelectField>
        {field('titleEn', { label: text('form.titleEn'), required: true, lang: 'en', ltr: true })}
        {field('titleAr', { label: text('form.titleAr'), required: true, lang: 'ar' })}
        {textarea('descriptionEn', text('form.descriptionEn'), 'en')}
        {textarea('descriptionAr', text('form.descriptionAr'), 'ar')}
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
        <div className="hidden sm:block" aria-hidden="true" />
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
        {field('minParticipants', {
          label: text('form.minParticipants'),
          required: true,
          numeric: true,
          hint: text('form.participantsHint'),
        })}
        {field('maxParticipants', {
          label: text('form.maxParticipants'),
          required: true,
          numeric: true,
        })}
        {props.showCosts ? (
          <>
            {field('estCostPerSession', {
              label: text('form.estCostPerSession', { currency: props.currency }),
              hint: text('form.costHint'),
              numeric: true,
            })}
            {field('estCostPerParticipant', {
              label: text('form.estCostPerParticipant', { currency: props.currency }),
              numeric: true,
            })}
          </>
        ) : null}
      </div>
      {message ? (
        <Alert tone={message.tone} data-testid="course-form-message">
          {message.text}
        </Alert>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={props.onDone} disabled={pending}>
          {text('form.cancel')}
        </Button>
        <Button type="submit" disabled={pending} data-testid="course-save">
          {pending ? text('form.saving') : text('form.save')}
        </Button>
      </div>
    </form>
  );
}

function texts(props: CourseDialogProps, key: 'required' | 'optional'): string {
  return props.texts[key] ?? '';
}
