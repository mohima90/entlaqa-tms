'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert, Badge, Button, Icon, TextField, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useState, useTransition } from 'react';
import {
  requestTenantEmailTestAction,
  saveTenantEmailSettingsAction,
  setTenantEmailEnabledAction,
} from '../../actions/email-integration';
import {
  type ProviderFormValues,
  fieldOfPath,
  providerFormValues,
  providerInput,
  providerLabel,
  secretStateFor,
} from '../../lib/email-settings-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { LeaveGuard } from '../settings/leave-guard';
import type { SettingsCommonTexts } from '../settings/settings-texts';
import { StepUpBanner } from '../settings/step-up-banner';
import { ProviderFields } from './provider-fields';

/**
 * Settings → Email integration «تكامل البريد الإلكتروني» (WP-ADM-01; FR-NTF-11), direction C (redesign
 * package 2, PO 21 Oct 2026): a «Who sends your e-mails» card, then the provider set-up as three numbered
 * steps in one card — 1 Provider (and its key), 2 Sender details then «Save settings», 3 Send a test
 * e-mail with the recipient inline (prefilled with the admin's own address, Q2-5) and, once a test went
 * out, «Use my provider» in the same step (one click, never automatic — Q2-4). Finished steps collapse to
 * a ✓ summary with Edit; feedback stays in the step being worked on, and a toast confirms. Same order and
 * rules as before: Save → Test → Turn on; the switch stays off until a test is sent and can always be
 * turned off (in the top card while the provider sends). Secrets are write-only.
 */
export interface EmailIntegrationFormProps {
  readonly saved: {
    readonly provider: string;
    readonly options: Record<string, unknown>;
    readonly credentialsCurrent: boolean;
    readonly fromName: string;
    readonly fromAddress: string;
    readonly replyTo: string | null;
    readonly enabled: boolean;
    readonly verified: boolean;
    readonly version: number;
  } | null;
  readonly platformSenderVerified: boolean;
  readonly keyReady: boolean;
  readonly editable: boolean;
  readonly organizationName: string;
  /** The signed-in admin's own address: the test recipient to start with (Q2-5). */
  readonly ownEmail: string;
  /** «Verified on …» (formatted on the server), or null. */
  readonly verifiedLabel: string | null;
  /** The latest test's line (server-rendered, a live region), or null. */
  readonly testLine: ReactNode;
  /** emailSettings texts, flattened. */
  readonly texts: Readonly<Record<string, string>>;
  readonly common: SettingsCommonTexts;
  readonly errors: ErrorTexts;
  /** The /mfa link back here, and whether saving needs a fresh authenticator code first (Q2-1). */
  readonly stepUp: { readonly href: string; readonly needed: boolean };
}

type Step = 'provider' | 'test' | 'switch';

interface Message {
  readonly step: Step;
  readonly tone: 'success' | 'danger' | 'info';
  readonly text: string;
}

function StepMarker({ done, number }: { readonly done: boolean; readonly number: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'z-10 grid size-10 shrink-0 place-items-center rounded-full font-bold',
        done ? 'bg-success text-surface' : 'bg-brand-gradient text-on-brand',
      )}
    >
      {done ? <Icon name="check" /> : number}
    </span>
  );
}

function StepShell({
  number,
  done,
  locked,
  title,
  status,
  action,
  last,
  children,
  testId,
}: {
  readonly number: number;
  readonly done: boolean;
  readonly locked?: boolean;
  readonly title: string;
  readonly status?: ReactNode;
  readonly action?: ReactNode;
  readonly last?: boolean;
  readonly children?: ReactNode;
  readonly testId: string;
}) {
  return (
    <li className="relative flex gap-4" data-testid={testId} data-done={done || undefined}>
      {last ? null : (
        <span aria-hidden="true" className="absolute inset-y-0 start-5 w-px bg-border" />
      )}
      {locked ? (
        <span
          aria-hidden="true"
          className="z-10 grid size-10 shrink-0 place-items-center rounded-full border-[1.5px] border-border-strong bg-surface font-bold text-text-muted"
        >
          {number}
        </span>
      ) : (
        <StepMarker done={done} number={number} />
      )}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-3', !last && 'pb-6')}>
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className={cn('m-0 text-[17px] font-bold', locked && 'text-text-muted')}>{title}</h3>
          {status}
          {action ? <div className="ms-auto">{action}</div> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

export function EmailIntegrationForm(props: EmailIntegrationFormProps) {
  const { saved, texts, errors, common } = props;
  const t = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string>) =>
    Object.entries(values).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, v), t(key));
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [provider, setProvider] = useState<ProviderFormValues>(providerFormValues(saved));
  const [fromName, setFromName] = useState(saved?.fromName ?? props.organizationName);
  const [fromAddress, setFromAddress] = useState(saved?.fromAddress ?? '');
  const [replyTo, setReplyTo] = useState(saved?.replyTo ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [recipient, setRecipient] = useState(props.ownEmail);
  const [recipientError, setRecipientError] = useState<string | undefined>();
  // Steps 1–2 open while nothing usable is saved (or the key must be entered again); else a summary.
  const [editing, setEditing] = useState(!saved?.credentialsCurrent);
  const [stepUp, setStepUp] = useState(props.stepUp.needed);
  const secretState = secretStateFor(saved, provider);
  const disabled = pending || !props.editable || !props.keyReady || stepUp;
  const own = saved?.enabled === true ? saved : null;
  const ownActive = own !== null;
  const settingsOpen = editing || !saved?.credentialsCurrent;
  // Unsaved entries in steps 1–2 (the leave guard, Q2-2).
  const dirty =
    settingsOpen &&
    (JSON.stringify(provider) !== JSON.stringify(providerFormValues(saved)) ||
      fromName !== (saved?.fromName ?? props.organizationName) ||
      fromAddress !== (saved?.fromAddress ?? '') ||
      replyTo !== (saved?.replyTo ?? ''));

  function refusal(error: AppError, step: Step) {
    if (sessionRefused(error)) return;
    if (error.code === 'STEP_UP_REQUIRED') {
      setStepUp(true);
      return;
    }
    const found: Record<string, string> = {};
    for (const fieldError of error.fieldErrors ?? []) {
      found[fieldOfPath(fieldError.path, provider.provider)] ??= t('fieldInvalid');
    }
    setFieldErrors(found);
    if (Object.keys(found).length > 0) setEditing(true);
    const formCode = error.fieldErrors?.find(
      (f) => f.path === 'form' || f.path === 'enabled',
    )?.code;
    const text =
      error.code === 'CONFLICT_VERSION'
        ? t('conflict')
        : formCode === 'TOO_SOON'
          ? t('testTooSoon')
          : formCode === 'KEY_CHANGED'
            ? t('keyChanged')
            : formCode === 'NOT_SET_UP'
              ? t('integration.keyMissing')
              : formCode === 'NOT_VERIFIED'
                ? t('integration.switchNeedsTest')
                : formCode === 'NOT_CONFIGURED'
                  ? t('integration.saveFirst')
                  : errorText(error, errors);
    setMessage({ step, tone: 'danger', text });
  }

  function onSave(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await saveTenantEmailSettingsAction({
        version: saved?.version ?? null,
        provider: providerInput(provider, secretState === 'saved'),
        fromName,
        fromAddress,
        replyTo,
      } as Parameters<typeof saveTenantEmailSettingsAction>[0]);
      if (result.ok) {
        setProvider((current) => ({
          ...current,
          apiKey: '',
          smtpPassword: '',
          graphClientSecret: '',
        }));
        const text =
          result.value.changed.length === 0
            ? t('integration.noChanges')
            : result.value.reverify
              ? t('integration.savedNeedsTest')
              : t('integration.saved');
        toast.success(text);
        setEditing(false);
        // The next step says what to do now.
        setMessage({ step: 'test', tone: 'success', text });
        router.refresh();
        return;
      }
      refusal(result.error, 'provider');
    });
  }

  function onToggle(enabled: boolean) {
    if (!saved) return;
    setMessage(null);
    startTransition(async () => {
      const result = await setTenantEmailEnabledAction({ enabled, version: saved.version });
      if (result.ok) {
        toast.success(t(enabled ? 'integration.switchedOn' : 'integration.switchedOff'));
        router.refresh();
        return;
      }
      refusal(result.error, 'switch');
    });
  }

  function onSendTest(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecipientError(undefined);
    setMessage(null);
    if (recipient.trim() === '') {
      setRecipientError(t('fieldInvalid'));
      return;
    }
    startTransition(async () => {
      const result = await requestTenantEmailTestAction({ recipient });
      if (result.ok) {
        toast.info(t('integration.testQueued'));
        setMessage({ step: 'test', tone: 'info', text: t('integration.testQueued') });
        router.refresh();
        return;
      }
      if (result.error.fieldErrors?.some((f) => f.path === 'recipient')) {
        setRecipientError(t('fieldInvalid'));
        return;
      }
      refusal(result.error, 'test');
    });
  }

  const stepMessage = (step: Step) =>
    message?.step === step ? (
      <Alert
        tone={message.tone}
        role={message.tone === 'danger' ? 'alert' : 'status'}
        data-testid="email-integration-message"
      >
        {message.text}
      </Alert>
    ) : null;

  const savedPill = (
    <Badge tone="success" dot>
      {common.saved}
    </Badge>
  );
  const editButton = (label: string) =>
    props.editable && !settingsOpen ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setEditing(true);
        }}
        aria-label={`${common.edit} · ${label}`}
        data-testid="email-integration-edit"
      >
        <Icon name="pencil" />
        {common.edit}
      </Button>
    ) : null;

  const switchControl = (id: string) =>
    saved && props.editable ? (
      <button
        type="button"
        role="switch"
        aria-checked={ownActive}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        disabled={pending || stepUp || (!ownActive && !saved.verified)}
        onClick={() => {
          onToggle(!ownActive);
        }}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          ownActive ? 'bg-primary' : 'bg-border-strong',
        )}
        data-testid="email-integration-enabled"
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-6 rounded-full bg-surface shadow-1 transition-transform motion-reduce:transition-none',
            ownActive ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    ) : null;

  const senderReady = ownActive || props.platformSenderVerified;

  return (
    // A focused field never hides behind the bottom of the screen (WCAG 2.4.11).
    <div className="flex flex-col gap-5 [&_button]:scroll-mb-40 [&_input]:scroll-mb-40 [&_select]:scroll-mb-40">
      {stepUp ? <StepUpBanner href={props.stepUp.href} texts={common} /> : null}
      <section
        aria-labelledby="email-integration-status"
        className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-5"
        data-testid="email-integration-status"
        data-sender={ownActive ? 'organization' : 'platform'}
      >
        <span
          aria-hidden="true"
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-lg',
            senderReady ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning',
          )}
        >
          <Icon
            name={ownActive ? 'server' : senderReady ? 'mail-check' : 'warning'}
            className="size-6"
          />
        </span>
        <div className="min-w-0 flex-[1_1_18rem]">
          <h2 id="email-integration-status" className="m-0 text-lg font-bold">
            {ownActive ? t('integration.statusOwnTitle') : t('integration.statusPlatformTitle')}
          </h2>
          <p className="m-0 text-text-muted">
            {own
              ? fill('integration.statusOwnText', {
                  provider: providerLabel(own.provider),
                  address: own.fromAddress,
                })
              : props.platformSenderVerified
                ? t('integration.statusPlatformText')
                : t('integration.statusPlatformNotReady')}
          </p>
        </div>
        {ownActive && saved && props.editable ? (
          <div className="flex max-w-80 flex-col gap-1">
            <div className="flex items-center gap-3">
              {switchControl('email-switch-top')}
              <span id="email-switch-top-label" className="text-sm font-semibold">
                {t('integration.switchLabel')}
              </span>
            </div>
            <p id="email-switch-top-hint" className="m-0 text-[13px] text-text-muted">
              {t('integration.switchHint')}
            </p>
          </div>
        ) : null}
        {ownActive ? <div className="w-full">{stepMessage('switch')}</div> : null}
      </section>

      <section
        aria-labelledby="email-integration-provider"
        className="rounded-xl border border-border bg-surface p-5 sm:p-6"
      >
        <div className="mb-5 flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary-text"
          >
            <Icon name="mail" />
          </span>
          <div>
            <h2 id="email-integration-provider" className="m-0 text-lg font-bold">
              {t('integration.providerTitle')}
            </h2>
            <p className="m-0 text-sm text-text-muted">{t('integration.providerIntro')}</p>
          </div>
        </div>
        <div className="flex flex-col">
          {settingsOpen ? (
            <form onSubmit={onSave} noValidate data-testid="email-integration-form">
              <ol className="m-0 flex list-none flex-col p-0">
                <StepShell
                  number={1}
                  done={false}
                  title={t('provider.label')}
                  testId="email-step-provider"
                >
                  <ProviderFields
                    idPrefix="email-integration"
                    values={provider}
                    onChange={setProvider}
                    disabled={disabled}
                    secretState={secretState}
                    errors={fieldErrors}
                    texts={texts}
                  />
                </StepShell>
                <StepShell
                  number={2}
                  done={false}
                  title={t('sender.title')}
                  testId="email-step-sender"
                >
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-5">
                    <TextField
                      id="email-integration-fromAddress"
                      name="fromAddress"
                      type="email"
                      dir="ltr"
                      autoComplete="off"
                      label={t('sender.fromAddress')}
                      marker={t('provider.required')}
                      hint={t('sender.fromAddressHint')}
                      error={fieldErrors.fromAddress}
                      value={fromAddress}
                      onChange={(event) => {
                        setFromAddress(event.target.value);
                      }}
                      disabled={disabled}
                      data-testid="email-integration-fromAddress"
                    />
                    <TextField
                      id="email-integration-fromName"
                      name="fromName"
                      autoComplete="off"
                      label={t('sender.fromName')}
                      marker={t('provider.required')}
                      error={fieldErrors.fromName}
                      value={fromName}
                      onChange={(event) => {
                        setFromName(event.target.value);
                      }}
                      disabled={disabled}
                      data-testid="email-integration-fromName"
                    />
                    <TextField
                      id="email-integration-replyTo"
                      name="replyTo"
                      type="email"
                      dir="ltr"
                      autoComplete="off"
                      label={t('sender.replyTo')}
                      marker={t('provider.optional')}
                      hint={t('sender.replyToHint')}
                      error={fieldErrors.replyTo}
                      value={replyTo}
                      onChange={(event) => {
                        setReplyTo(event.target.value);
                      }}
                      disabled={disabled}
                      data-testid="email-integration-replyTo"
                    />
                  </div>
                  {stepMessage('provider')}
                  {props.editable ? (
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="submit"
                        disabled={disabled}
                        aria-busy={pending || undefined}
                        data-testid="email-integration-save"
                      >
                        {pending ? t('integration.saving') : t('integration.save')}
                      </Button>
                      {saved?.credentialsCurrent ? (
                        <Button
                          variant="secondary"
                          disabled={pending}
                          onClick={() => {
                            setEditing(false);
                            setFieldErrors({});
                            setMessage(null);
                          }}
                        >
                          {t('integration.testCancel')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </StepShell>
              </ol>
            </form>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              <StepShell
                number={1}
                done
                title={t('provider.label')}
                status={savedPill}
                action={editButton(t('provider.label'))}
                testId="email-step-provider"
              >
                <p className="m-0 text-text-muted" lang="en" dir="ltr">
                  <bdi>{providerLabel(saved.provider)}</bdi>
                </p>
              </StepShell>
              <StepShell
                number={2}
                done
                title={t('sender.title')}
                status={savedPill}
                action={editButton(t('sender.title'))}
                testId="email-step-sender"
              >
                <p className="m-0 text-text-muted">
                  {saved.fromName} · <bdi dir="ltr">{saved.fromAddress}</bdi>
                </p>
              </StepShell>
            </ol>
          )}
          <ol start={3} className="m-0 flex list-none flex-col p-0">
            <StepShell
              number={3}
              done={saved?.verified === true}
              locked={saved === null}
              title={t('integration.testDialogTitle')}
              status={
                saved?.verified && props.verifiedLabel ? (
                  <Badge tone="success" dot data-testid="email-verified">
                    {props.verifiedLabel}
                  </Badge>
                ) : null
              }
              last
              testId="email-step-test"
            >
              {saved === null ? (
                <p className="m-0 text-text-muted" data-testid="email-step-test-locked">
                  {t('integration.saveFirst')}
                </p>
              ) : (
                <>
                  {stepMessage('test')}
                  <p className="m-0 text-sm text-text-muted">{t('integration.testDialogIntro')}</p>
                  {props.editable ? (
                    <form
                      className="flex flex-wrap items-start gap-3"
                      onSubmit={onSendTest}
                      noValidate
                      data-testid="email-test-form"
                    >
                      <TextField
                        id="email-test-recipient"
                        name="recipient"
                        type="email"
                        dir="ltr"
                        autoComplete="email"
                        className="min-w-0 flex-[1_1_16rem]"
                        label={t('integration.testRecipient')}
                        marker={t('provider.required')}
                        error={recipientError}
                        value={recipient}
                        onChange={(event) => {
                          setRecipient(event.target.value);
                        }}
                        disabled={pending || !props.keyReady || stepUp}
                        data-testid="email-test-recipient"
                      />
                      <Button
                        type="submit"
                        variant={saved.verified ? 'secondary' : 'primary'}
                        disabled={pending || !props.keyReady || stepUp}
                        className="mt-7"
                        data-testid="email-test-send"
                      >
                        <Icon name="send" />
                        {saved.verified ? t('integration.sendTest') : t('integration.testSend')}
                      </Button>
                    </form>
                  ) : null}
                  {props.testLine}
                  {!ownActive && props.editable ? (
                    <div
                      className="flex flex-wrap items-center gap-4 rounded-lg border-[1.5px] border-primary/40 bg-primary-subtle p-4"
                      data-testid="email-switch-step"
                    >
                      <div className="min-w-0 flex-[1_1_16rem]">
                        <p id="email-switch-step-label" className="m-0 font-semibold">
                          {t('integration.switchLabel')}
                        </p>
                        <p id="email-switch-step-hint" className="m-0 text-sm text-text-muted">
                          {saved.verified
                            ? t('integration.switchHint')
                            : t('integration.switchNeedsTest')}
                        </p>
                      </div>
                      {switchControl('email-switch-step')}
                    </div>
                  ) : null}
                  {!ownActive ? stepMessage('switch') : null}
                </>
              )}
            </StepShell>
          </ol>
        </div>
      </section>
      <LeaveGuard active={props.editable && dirty && !pending} texts={common} />
    </div>
  );
}
