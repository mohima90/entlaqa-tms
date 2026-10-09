'use client';
import { Alert, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { deactivateMemberAction } from '../../actions/users';
import {
  type DeactivateFormState,
  chooseForAll,
  deactivateInput,
  deactivationErrorKeys,
  initialDeactivateState,
  missingOwners,
} from '../../lib/deactivate-form';
import { type ErrorTexts, errorText } from '../auth/error-text';

/** One kind of item the person is responsible for (texts formatted on the server). */
export interface DeactivationKindRow {
  readonly code: string;
  /** «3 أشخاص يتبعون هذا المستخدم مباشرة» */
  readonly title: string;
  /** The first names, e.g. «أحمد، سارة (+1)». */
  readonly names: string;
  /** Label of the owner picker (visually hidden, as on screen 4). */
  readonly picker: string;
  /** Why the signed-in member cannot move these (the form is then blocked), or null. */
  readonly blockedText: string | null;
}

export interface DeactivateMemberFormProps {
  readonly personId: string;
  readonly kinds: readonly DeactivationKindRow[];
  readonly candidates: readonly { readonly personId: string; readonly name: string }[];
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
  /** Texts of namespace `deactivation`. */
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly cancelHref: string;
  readonly successHref: string;
}

const fieldClass =
  'min-h-11 w-full rounded-md border bg-surface px-3 text-text sm:w-auto sm:min-w-64 sm:flex-1';

/**
 * Screen 4 «تعطيل المستخدم» (T-M2-09, FR-IAM-05): what the person is responsible for gets a new owner —
 * one picker for all («نقل الكل إلى») or one per kind — then the account is deactivated, with an optional
 * reason for the audit log. Nothing is sent while an owner is missing or a kind cannot be moved by the
 * signed-in member; the server checks everything again.
 */
export function DeactivateMemberForm(props: DeactivateMemberFormProps) {
  const { labels, kinds, candidates } = props;
  const text = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const views = kinds.map((k) => ({ code: k.code, blocked: k.blockedText !== null }));
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<DeactivateFormState>(() => initialDeactivateState(views));
  const [formError, setFormError] = useState<string | null>(null);
  const [kindErrors, setKindErrors] = useState<Readonly<Record<string, string>>>({});
  const blocked = views.some((k) => k.blocked);
  const noCandidates = kinds.length > 0 && candidates.length === 0;
  const idOf = (code: string) => code.replaceAll('.', '-');

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || noCandidates) return;
    const missing = missingOwners(state, views);
    if (missing.length > 0) {
      setFormError(null);
      setKindErrors(Object.fromEntries(missing.map((code) => [code, 'fieldErrors.ownerRequired'])));
      // The first missing picker gets focus (its error is in its description).
      const first = missing[0];
      if (first) document.getElementById(`owner-${idOf(first)}`)?.focus();
      return;
    }
    setFormError(null);
    setKindErrors({});
    startTransition(async () => {
      // The reason comes from the server's own list (the action validates it again).
      const input = deactivateInput(props.personId, state, views) as Parameters<
        typeof deactivateMemberAction
      >[0];
      const result = await deactivateMemberAction(input);
      if (!result.ok) {
        const keys = deactivationErrorKeys(result.error, views);
        setKindErrors(keys.kinds);
        setFormError(keys.form ? text(keys.form) : errorText(result.error, props.errors));
        const first = Object.keys(keys.kinds)[0];
        if (first) document.getElementById(`owner-${idOf(first)}`)?.focus();
        return;
      }
      router.push(props.successHref);
    });
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit} noValidate data-testid="deactivate">
      {kinds.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="items-heading">
          <h2 id="items-heading" className="m-0 text-lg font-semibold">
            {text('itemsHeading')}
          </h2>
          {noCandidates ? (
            <Alert tone="warning" data-testid="no-candidates">
              {text('noCandidates')}
            </Alert>
          ) : null}
          {kinds.length > 1 && !blocked && !noCandidates ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-sunken px-4 py-3">
              <label htmlFor="owner-all" className="font-semibold">
                {text('moveAllTo')}
              </label>
              <select
                id="owner-all"
                value={state.allTo}
                disabled={pending}
                onChange={(event) => {
                  setKindErrors({});
                  setState((s) => chooseForAll(s, views, event.target.value));
                }}
                className={`${fieldClass} border-border-strong`}
                data-testid="owner-all"
              >
                <option value="">{text('choosePerson')}</option>
                {candidates.map((c) => (
                  <option key={c.personId} value={c.personId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {kinds.map((kind) => {
              const id = idOf(kind.code);
              const errorKey = kindErrors[kind.code];
              return (
                <li
                  key={kind.code}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4"
                  data-testid={`kind-${kind.code}`}
                >
                  <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
                    <span id={`${id}-title`} className="font-semibold">
                      {kind.title}
                    </span>
                    <span className="text-sm text-text-muted">{kind.names}</span>
                  </div>
                  {kind.blockedText ? (
                    <p className="m-0 basis-full text-sm font-medium" data-testid="kind-blocked">
                      {kind.blockedText}
                    </p>
                  ) : noCandidates ? null : (
                    <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
                      <label htmlFor={`owner-${id}`} className="sr-only">
                        {kind.picker}
                      </label>
                      <select
                        id={`owner-${id}`}
                        value={state.owners[kind.code] ?? ''}
                        disabled={pending}
                        aria-describedby={`${id}-title${errorKey ? ` ${id}-error` : ''}`}
                        aria-invalid={errorKey ? true : undefined}
                        onChange={(event) => {
                          const value = event.target.value;
                          setKindErrors((errors) =>
                            Object.fromEntries(
                              Object.entries(errors).filter(([code]) => code !== kind.code),
                            ),
                          );
                          setState((s) => ({ ...s, owners: { ...s.owners, [kind.code]: value } }));
                        }}
                        className={`${fieldClass} ${errorKey ? 'border-danger' : 'border-border-strong'}`}
                        data-testid={`owner-${kind.code}`}
                      >
                        <option value="">{text('choosePerson')}</option>
                        {candidates.map((c) => (
                          <option key={c.personId} value={c.personId}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {errorKey ? (
                        <p id={`${id}-error`} className="m-0 text-sm font-medium text-danger">
                          {text(errorKey)}
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="deactivation-reason" className="font-semibold">
          {text('reason')} <span className="font-normal text-text-muted">{text('reasonHint')}</span>
        </label>
        <select
          id="deactivation-reason"
          value={state.reason}
          disabled={pending}
          onChange={(event) => {
            const value = event.target.value;
            setState((s) => ({ ...s, reason: value }));
          }}
          className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-text"
          data-testid="deactivation-reason"
        >
          <option value="">{text('reasonNone')}</option>
          {props.reasons.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {formError ? (
        <Alert tone="danger" data-testid="deactivate-message">
          {formError}
        </Alert>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <a href={props.cancelHref} className={buttonClasses({ variant: 'secondary' })}>
          {text('cancel')}
        </a>
        <button
          type="submit"
          className={buttonClasses({ variant: 'danger' })}
          disabled={pending || blocked || noCandidates}
          data-testid="deactivate-submit"
        >
          {pending ? text('working') : kinds.length > 0 ? text('submitMove') : text('submit')}
        </button>
      </div>
    </form>
  );
}
