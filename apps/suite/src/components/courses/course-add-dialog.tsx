'use client';
import { Alert, Button, Dialog, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { createCourseAction } from '../../actions/courses';
import {
  type CourseQuickField,
  type CourseQuickState,
  EMPTY_COURSE_QUICK,
  courseFieldErrorKey,
  courseFormFieldOf,
  parseCourseQuickForm,
} from '../../lib/courses-view';
import { nameOrder } from '../../lib/structure-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';

export interface CourseAddDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The language whose title is required: the organization's default language (PO, 12 Nov 2026). */
  readonly nameLanguage: 'ar' | 'en';
  /** The delivery types offered, in list order, with their names. */
  readonly deliveryTypes: readonly { readonly value: string; readonly label: string }[];
  /** Without a database: the popup checks the values but saves nothing. */
  readonly preview: boolean;
  /** The `courses` messages, raw, by dotted key; plus `required` and `optional`. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * «Add course» — one centred popup, 672 px (forms standard rule 9; WP-UX-01 c, T-M3-21; FR-CAT-01): the
 * course's title in the organization's default language (the other language optional), its delivery type
 * and its hours. The code, the participants, the category, the description and the estimated costs are
 * filled in or left empty (COURSE_DEFAULTS) and wait on the course's Settings page. «Cancel», then «Add
 * course» at the end. The fields are mounted when the popup opens, so every opening starts empty.
 */
export function CourseAddDialog(props: CourseAddDialogProps) {
  const text = (key: string) => props.texts[key] ?? key;
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      canClose={() => !busy}
      size="rich"
      title={text('form.addTitle')}
      description={text('form.intro')}
      closeLabel={text('form.close')}
      data-testid="course-dialog"
    >
      {props.open ? <AddForm {...props} onBusy={setBusy} /> : null}
    </Dialog>
  );
}

type Errors = Partial<Record<CourseQuickField, string>>;

function AddForm(props: CourseAddDialogProps & { readonly onBusy: (busy: boolean) => void }) {
  const { texts } = props;
  const text = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CourseQuickState>(EMPTY_COURSE_QUICK);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);

  const set = (field: CourseQuickField, value: string) => {
    setState((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const errorOf = (field: CourseQuickField) => {
    const code = errors[field];
    return code ? text(`fieldErrors.${courseFieldErrorKey(code)}`) : undefined;
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = parseCourseQuickForm(state, props.nameLanguage);
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
    props.onBusy(true);
    startTransition(async () => {
      try {
        const result = await createCourseAction(values);
        if (result.ok) {
          toast.success(text('created'));
          props.onClose();
          router.refresh();
          return;
        }
        if (sessionRefused(result.error)) return;
        if (result.error.code === 'VALIDATION_FAILED') {
          const next: Errors = {};
          for (const fieldError of result.error.fieldErrors ?? []) {
            const field = courseFormFieldOf(fieldError.path);
            if (field && field in EMPTY_COURSE_QUICK) {
              next[field as CourseQuickField] ??= fieldError.code;
            }
          }
          setErrors(next);
        }
        setMessage({ tone: 'danger', text: errorText(result.error, props.errors) });
      } finally {
        props.onBusy(false);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="course-form">
      {message ? (
        <Alert tone={message.tone} data-testid="course-form-message">
          {message.text}
        </Alert>
      ) : null}
      {/* The title in the organization's default language first and required; the other language is
          optional (PO, 12 Nov 2026). Side by side on a desktop, one per row on a phone. */}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {nameOrder(props.nameLanguage).map((language) => {
          const field = language === 'ar' ? 'titleAr' : 'titleEn';
          const required = language === props.nameLanguage;
          return (
            <TextField
              key={field}
              id={`course-new-${field}`}
              label={text(`form.${field}`)}
              marker={required ? texts.required : texts.optional}
              value={state[field]}
              onChange={(event) => {
                set(field, event.target.value);
              }}
              maxLength={200}
              required={required}
              dir={language === 'ar' ? 'rtl' : 'ltr'}
              lang={language}
              autoComplete="off"
              error={errorOf(field)}
              disabled={pending}
              data-testid={`course-field-${field}`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <SelectField
          id="course-new-deliveryType"
          label={text('form.deliveryType')}
          marker={texts.required}
          aria-required
          value={state.deliveryType}
          onChange={(event) => {
            set('deliveryType', event.target.value);
          }}
          error={errorOf('deliveryType')}
          disabled={pending}
          data-testid="course-field-deliveryType"
        >
          {props.deliveryTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </SelectField>
        <TextField
          id="course-new-durationHours"
          label={text('form.durationHours')}
          marker={texts.required}
          value={state.durationHours}
          onChange={(event) => {
            set('durationHours', event.target.value);
          }}
          required
          inputMode="decimal"
          autoComplete="off"
          error={errorOf('durationHours')}
          disabled={pending}
          data-testid="course-field-durationHours"
        />
      </div>
      <p
        className="m-0 rounded-xl bg-surface-sunken px-3.5 py-3 text-[13px] leading-relaxed text-text-muted"
        data-testid="course-dialog-note"
      >
        {text('form.note')}
      </p>
      {/* «Cancel», then the primary button at the end; the footer stays in view on a short screen. */}
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-1.5 flex flex-col-reverse gap-2.5 border-t border-border bg-surface-raised px-6 py-4 sm:-mx-6.5 sm:-mb-6.5 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6.5">
        <Button
          variant="secondary"
          onClick={props.onClose}
          disabled={pending}
          data-testid="course-cancel"
        >
          {text('form.cancel')}
        </Button>
        <Button type="submit" disabled={pending} busy={pending} data-testid="course-save">
          {pending ? text('form.saving') : text('addCourse')}
        </Button>
      </div>
    </form>
  );
}
