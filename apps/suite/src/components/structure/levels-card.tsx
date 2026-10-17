'use client';
import { Alert, Button, Card, Dialog, Icon, TextField, tableClasses, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import {
  addStructureLevelAction,
  removeStructureLevelAction,
  renameStructureLevelAction,
} from '../../actions/structure';
import { fillText } from '../../lib/fill-text';
import { levelFieldText } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { ConfirmDialog } from './confirm-dialog';
import { type Failure, failureOf } from './failure';

/** A level as the page shows it. */
export interface LevelView {
  readonly id: string;
  readonly ordinal: number;
  readonly nameEn: string;
  readonly nameAr: string;
  /** In the page's language. */
  readonly name: string;
  readonly version: number;
  readonly unitCount: number;
  /** «3 units use this level…» (formatted on the server), shown when removal is refused. */
  readonly inUseLabel: string;
}

export interface LevelsCardProps {
  readonly levels: readonly LevelView[];
  readonly canManage: boolean;
  /** Ten levels at most (MAX_STRUCTURE_LEVELS). */
  readonly maxLevels: number;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
}

type DialogState =
  | { readonly kind: 'add' }
  | { readonly kind: 'rename'; readonly level: LevelView }
  | { readonly kind: 'remove'; readonly level: LevelView };

/**
 * Structure → Levels (FR-ADM-05, EP-ORG BR-ORG-b; PO 17 Oct 2026: each organization names its own levels):
 * the ordered levels with their English and Arabic names and the number of units at each; the HR Manager
 * adds a level at the bottom (up to ten), renames any level and removes the last one while no unit uses it.
 */
export function LevelsCard(props: LevelsCardProps) {
  const { levels, canManage, texts, locale } = props;
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const last = levels.at(-1);
  const full = levels.length >= props.maxLevels;

  return (
    <>
      <Card
        flush
        icon="plan"
        title={text('levels.title')}
        description={text('levels.description')}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setDialog({ kind: 'add' });
              }}
              disabled={full}
              data-testid="level-add"
            >
              <Icon name="plus" />
              {text('levels.add')}
            </Button>
          ) : null
        }
        data-testid="structure-levels"
      >
        <div
          className={`${tableClasses.wrapper} focus-visible:outline-2 focus-visible:outline-offset-2`}
          // Scrolls on phones: focusable so the keyboard can scroll it too (WCAG 2.1.1; axe
          // scrollable-region-focusable — a view-only table has nothing focusable).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
          tabIndex={0}
          role="region"
          aria-label={text('levels.caption')}
        >
          <table className={tableClasses.table} data-testid="levels-table">
            <caption className="sr-only">{text('levels.caption')}</caption>
            <thead className={tableClasses.header}>
              <tr>
                <th scope="col" className={tableClasses.head}>
                  {text('levels.columns.level')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {text('levels.columns.nameEn')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {text('levels.columns.nameAr')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {text('levels.columns.units')}
                </th>
                {canManage ? (
                  <th scope="col" className={`${tableClasses.head} text-end`}>
                    {text('levels.columns.actions')}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr
                  key={level.id}
                  className={tableClasses.row}
                  data-testid={`level-row-${String(level.ordinal)}`}
                >
                  <td className={tableClasses.cell}>
                    {fill('levels.levelNumber', { ordinal: level.ordinal })}
                  </td>
                  <td className={tableClasses.cell}>
                    <span dir="ltr" lang="en">
                      {level.nameEn}
                    </span>
                  </td>
                  <td className={tableClasses.cell}>
                    <span dir="rtl" lang="ar">
                      {level.nameAr}
                    </span>
                  </td>
                  <td className={`${tableClasses.cell} tabular-nums`}>{level.unitCount}</td>
                  {canManage ? (
                    <td className={`${tableClasses.cell} text-end`}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                          aria-label={fill('levels.renameFor', { name: level.name })}
                          onClick={() => {
                            setDialog({ kind: 'rename', level });
                          }}
                          data-testid="level-rename"
                        >
                          <Icon name="pencil" />
                        </button>
                        {level === last && level.ordinal > 1 ? (
                          <button
                            type="button"
                            className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-danger pointer-coarse:size-11"
                            aria-label={fill('levels.removeFor', { name: level.name })}
                            onClick={() => {
                              setDialog({ kind: 'remove', level });
                            }}
                            data-testid="level-remove"
                          >
                            <Icon name="trash" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 border-t border-border px-6 py-3 text-sm text-text-muted">
          {full ? text('levels.full') : text('levels.example')}
        </p>
      </Card>

      {dialog?.kind === 'add' || dialog?.kind === 'rename' ? (
        <LevelDialog
          level={dialog.kind === 'rename' ? dialog.level : null}
          lastName={last?.name ?? ''}
          text={text}
          fill={fill}
          errors={props.errors}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={(message) => {
            toast.success(message);
            router.refresh();
          }}
          sessionRefused={sessionRefused}
        />
      ) : null}

      {dialog?.kind === 'remove' ? (
        <ConfirmDialog
          title={fill('levels.removeTitle', { name: dialog.level.name })}
          description={text('levels.removeText')}
          confirmLabel={text('levels.confirmRemove')}
          workingLabel={text('form.saving')}
          keepLabel={text('levels.keep')}
          closeLabel={text('form.close')}
          danger
          canConfirm={dialog.level.unitCount === 0}
          onClose={() => {
            setDialog(null);
          }}
          data-testid="level-remove-dialog"
          onConfirm={async () => {
            const result = await removeStructureLevelAction({
              id: dialog.level.id,
              version: dialog.level.version,
            });
            if (result.ok) {
              toast.success(text('toasts.levelRemoved'));
              router.refresh();
              return null;
            }
            if (sessionRefused(result.error)) return null;
            const failure = failureOf(result.error, text, props.errors, levelFieldText);
            const message = failure.message ?? Object.values(failure.fields)[0] ?? null;
            // The count of a level in use comes formatted from the server.
            return message === text('levels.inUse') ? dialog.level.inUseLabel : message;
          }}
        >
          {dialog.level.unitCount > 0 ? (
            <Alert tone="warning" data-testid="level-in-use">
              {dialog.level.inUseLabel}
            </Alert>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function LevelDialog({
  level,
  lastName,
  text,
  fill,
  errors,
  onClose,
  onSaved,
  sessionRefused,
}: {
  readonly level: LevelView | null;
  readonly lastName: string;
  readonly text: (key: string) => string;
  readonly fill: (key: string, values: Record<string, string | number>) => string;
  readonly errors: ErrorTexts;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => void;
  readonly sessionRefused: (error: Parameters<typeof failureOf>[0]) => boolean;
}) {
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure>({ fields: {}, message: null });

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const names = { nameEn: field('nameEn'), nameAr: field('nameAr') };
    setFailure({ fields: {}, message: null });
    startTransition(async () => {
      const result = level
        ? await renameStructureLevelAction({ ...names, id: level.id, version: level.version })
        : await addStructureLevelAction(names);
      if (result.ok) {
        setOpen(false);
        onSaved(level ? text('toasts.levelRenamed') : text('toasts.levelAdded'));
        return;
      }
      if (sessionRefused(result.error)) return;
      setFailure(failureOf(result.error, text, errors, levelFieldText));
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={level ? fill('levels.renameTitle', { name: level.name }) : text('levels.addTitle')}
      description={
        level
          ? text('levels.renameDescription')
          : fill('levels.addDescription', { level: lastName })
      }
      closeLabel={text('form.close')}
      data-testid="level-dialog"
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="level-nameEn"
            name="nameEn"
            label={text('form.nameEn')}
            marker={text('required')}
            required
            dir="ltr"
            lang="en"
            maxLength={60}
            autoComplete="off"
            defaultValue={level?.nameEn ?? ''}
            error={failure.fields.nameEn}
            disabled={pending}
          />
          <TextField
            id="level-nameAr"
            name="nameAr"
            label={text('form.nameAr')}
            marker={text('required')}
            required
            dir="rtl"
            lang="ar"
            maxLength={60}
            autoComplete="off"
            defaultValue={level?.nameAr ?? ''}
            error={failure.fields.nameAr}
            disabled={pending}
          />
        </div>
        <p className="m-0 text-sm text-text-muted">{text('form.audited')}</p>
        {failure.message ? (
          <Alert tone="danger" data-testid="level-dialog-message">
            {failure.message}
          </Alert>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
            disabled={pending}
          >
            {text('form.cancel')}
          </Button>
          <Button type="submit" disabled={pending} data-testid="level-dialog-submit">
            {pending ? text('form.saving') : level ? text('form.save') : text('levels.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
