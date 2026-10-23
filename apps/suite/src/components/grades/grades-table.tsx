'use client';
import {
  Badge,
  type Breadcrumb,
  Button,
  Dialog,
  EmptyState,
  Icon,
  ListCard,
  ListCards,
  PageHeader,
  TextField,
  iconButtonClasses,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useEffect, useState } from 'react';
import { addGradeAction, deleteGradeAction, renameGradeAction } from '../../actions/grades';
import { fillText } from '../../lib/fill-text';
import { type GradeRowView, checkGradeCode } from '../../lib/grades-view';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';

export interface GradesTableProps {
  readonly rows: readonly GradeRowView[];
  /** Sign-in and database configured: the buttons work. */
  readonly live: boolean;
  readonly header: {
    readonly title: string;
    readonly description: string;
    readonly breadcrumbs: readonly Breadcrumb[];
    readonly breadcrumbsLabel: string;
  };
  readonly notice: ReactNode;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

type DialogState =
  | { readonly kind: 'form'; readonly grade: GradeRowView | null }
  | { readonly kind: 'delete'; readonly grade: GradeRowView }
  | { readonly kind: 'blocked'; readonly grade: GradeRowView }
  | null;

/**
 * Organization → Grades (WP-ADM-04; design S04-5): the organization's list of grade codes, kept by HR and the
 * Organization Admin. A table (cards on phones) with the code, how many people hold it, rename and delete.
 * Add and rename use a one-field dialog: the message goes on the field when the button is pressed and focus
 * moves to it. A grade people still hold cannot be deleted — the dialog says why and what to do. Every
 * change is audited (codes only).
 */
export function GradesTable(props: GradesTableProps) {
  const { rows, texts } = props;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const text = (key: string) => texts[key] ?? key;

  // The message is on the field: focus moves there once the answer is shown (package 1 pattern).
  useEffect(() => {
    if (error !== undefined) document.getElementById('grade-code')?.focus();
  }, [error]);

  function close() {
    if (busy) return;
    setDialog(null);
    setError(undefined);
  }

  async function submitForm(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog?.kind !== 'form' || busy) return;
    const typed = new FormData(event.currentTarget).get('code');
    const checked = checkGradeCode(typeof typed === 'string' ? typed : '');
    if ('problem' in checked) {
      setError(text(checked.problem === 'required' ? 'errRequired' : 'errFormat'));
      return;
    }
    if (!props.live) return;
    setError(undefined);
    setBusy(true);
    try {
      const grade = dialog.grade;
      const result = grade
        ? await renameGradeAction({ id: grade.id, code: checked.code })
        : await addGradeAction({ code: checked.code });
      if (!result.ok) {
        if (sessionRefused(result.error)) return;
        if (result.error.code === 'VALIDATION_FAILED') {
          const code = fieldErrorCodes(result.error).code;
          setError(
            code === 'TAKEN'
              ? fillText(text('errTaken'), { code: checked.code })
              : text('errFormat'),
          );
        } else {
          setError(errorText(result.error, props.errors));
        }
        return;
      }
      toast.success(
        grade
          ? fillText(text('renamed'), { code: checked.code })
          : fillText(text('added'), { code: checked.code }),
      );
      setDialog(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (dialog?.kind !== 'delete' || busy || !props.live) return;
    setBusy(true);
    try {
      const grade = dialog.grade;
      const result = await deleteGradeAction({ id: grade.id });
      if (!result.ok) {
        if (sessionRefused(result.error)) return;
        // Someone was given the grade meanwhile: the reason dialog, after a refresh.
        if (result.error.code === 'VALIDATION_FAILED') {
          setDialog({ kind: 'blocked', grade });
          router.refresh();
        } else {
          toast.error(errorText(result.error, props.errors));
          setDialog(null);
        }
        return;
      }
      toast.success(fillText(text('deleted'), { code: grade.code }));
      setDialog(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const actions = (grade: GradeRowView) => (
    <span className="flex items-center justify-end gap-1">
      <button
        type="button"
        className={iconButtonClasses}
        aria-label={grade.renameLabel}
        onClick={() => {
          setError(undefined);
          setDialog({ kind: 'form', grade });
        }}
        data-testid={`grade-rename-${grade.code}`}
      >
        <Icon name="pencil" />
      </button>
      <button
        type="button"
        className={iconButtonClasses}
        aria-label={grade.deleteLabel}
        onClick={() => {
          setDialog({ kind: grade.people > 0 ? 'blocked' : 'delete', grade });
        }}
        data-testid={`grade-delete-${grade.code}`}
      >
        <Icon name="trash" />
      </button>
    </span>
  );

  const addButton = (
    <Button
      onClick={() => {
        setError(undefined);
        setDialog({ kind: 'form', grade: null });
      }}
      className="w-full md:w-auto"
      data-testid="grade-add"
    >
      <Icon name="plus" />
      {text('add')}
    </Button>
  );

  const editing = dialog?.kind === 'form' ? dialog.grade : null;
  return (
    <>
      <PageHeader
        title={props.header.title}
        description={props.header.description}
        breadcrumbs={props.header.breadcrumbs}
        breadcrumbsLabel={props.header.breadcrumbsLabel}
        actions={addButton}
      />
      <div className="flex flex-col gap-6">
        {props.notice}
        <section
          aria-labelledby="grades-card-title"
          className="overflow-hidden rounded-xl border border-border bg-surface"
          data-testid="grades-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-5.5 pb-4 pt-5">
            <h2 id="grades-card-title" className="m-0 text-lg font-bold">
              {text('title')}
            </h2>
            {rows.length > 0 ? <Badge data-testid="grades-count">{text('countText')}</Badge> : null}
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon="star"
              headingLevel={3}
              title={text('emptyTitle')}
              description={text('emptyBody')}
              action={addButton}
              data-testid="grades-empty"
            />
          ) : (
            <>
              <div
                className={`${tableClasses.wrapper} hidden focus-visible:outline-2 focus-visible:outline-offset-2 md:block`}
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
                tabIndex={0}
                role="region"
                aria-label={text('caption')}
              >
                <table className={tableClasses.table} data-testid="grades-table">
                  <caption className="sr-only">{text('caption')}</caption>
                  <thead className={tableClasses.header}>
                    <tr>
                      <th scope="col" className={tableClasses.head}>
                        {text('colCode')}
                      </th>
                      <th scope="col" className={tableClasses.head}>
                        {text('colPeople')}
                      </th>
                      <th scope="col" className={tableClasses.head}>
                        <span className="sr-only">{text('colActions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((grade) => (
                      <tr key={grade.id} className={tableClasses.row}>
                        <th scope="row" className={`${tableClasses.cell} text-start font-semibold`}>
                          <bdi dir="ltr">{grade.code}</bdi>
                        </th>
                        <td className={tableClasses.cell}>{grade.peopleText}</td>
                        <td className={`${tableClasses.cell} text-end`}>{actions(grade)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListCards className="border-t border-border" data-testid="grades-cards">
                {rows.map((grade) => (
                  <ListCard
                    key={grade.id}
                    title={<bdi dir="ltr">{grade.code}</bdi>}
                    detail={grade.peopleText}
                    action={actions(grade)}
                  />
                ))}
              </ListCards>
            </>
          )}
          <p className="m-0 border-t border-border px-5.5 py-3.5 text-[13.5px] text-text-muted">
            {text('audit')}
          </p>
        </section>
      </div>

      <Dialog
        open={dialog?.kind === 'form'}
        onClose={close}
        title={editing ? editing.editTitle : text('addTitle')}
        description={editing?.editNote ?? undefined}
        closeLabel={text('close')}
        canClose={() => !busy}
        data-testid="grade-dialog"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            void submitForm(event);
          }}
          noValidate
        >
          <TextField
            // A new element for each dialog, so the typed value never leaks from one grade to the next.
            key={editing?.id ?? 'new'}
            id="grade-code"
            name="code"
            label={text('codeLabel')}
            hint={text('codeHint')}
            defaultValue={editing?.code ?? ''}
            dir="ltr"
            maxLength={24}
            autoComplete="off"
            autoCapitalize="characters"
            error={error}
            disabled={busy}
          />
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={close} disabled={busy}>
              {text('cancel')}
            </Button>
            <Button type="submit" busy={busy} data-testid="grade-save">
              {editing ? text('saveConfirm') : text('addConfirm')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog?.kind === 'delete'}
        onClose={close}
        tone="danger"
        title={dialog?.kind === 'delete' ? dialog.grade.deleteTitle : ''}
        description={text('deleteText')}
        closeLabel={text('close')}
        canClose={() => !busy}
        data-testid="grade-delete-dialog"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              {text('cancel')}
            </Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={() => {
                void confirmDelete();
              }}
              data-testid="grade-delete-confirm"
            >
              {text('deleteConfirm')}
            </Button>
          </>
        }
      />

      <Dialog
        open={dialog?.kind === 'blocked'}
        onClose={close}
        tone="warning"
        title={dialog?.kind === 'blocked' ? dialog.grade.blockedTitle : ''}
        description={dialog?.kind === 'blocked' ? dialog.grade.blockedText : undefined}
        closeLabel={text('close')}
        data-testid="grade-blocked-dialog"
        footer={<Button onClick={close}>{text('understood')}</Button>}
      />
    </>
  );
}
