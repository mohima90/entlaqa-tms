'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert, Button, Card, Dialog, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
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
import { ProviderFields } from './provider-fields';

/**
 * Settings → Email integration «تكامل البريد الإلكتروني» (WP-ADM-01; Kawadir's org Email settings, the
 * provider part, Jadarat palette): the status banner with «استخدام مزوّدي» / Use my provider (on only once a
 * test went out; off = back to the platform sender at any time), the provider card (provider, fields with
 * write-only secrets, from address and name, reply-to; Save settings; Send test e-mail in a dialog).
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
  /** emailSettings texts, flattened. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

interface Message {
  readonly tone: 'success' | 'danger' | 'info';
  readonly text: string;
}

export function EmailIntegrationForm(props: EmailIntegrationFormProps) {
  const { saved, texts, errors } = props;
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
  const [testOpen, setTestOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [recipientError, setRecipientError] = useState<string | undefined>();
  const secretState = secretStateFor(saved, provider);
  const disabled = pending || !props.editable || !props.keyReady;
  const own = saved?.enabled === true ? saved : null;
  const ownActive = own !== null;

  function refusal(error: AppError) {
    if (sessionRefused(error)) return;
    const found: Record<string, string> = {};
    for (const fieldError of error.fieldErrors ?? []) {
      found[fieldOfPath(fieldError.path, provider.provider)] ??= t('fieldInvalid');
    }
    setFieldErrors(found);
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
    setMessage({ tone: 'danger', text });
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
        setMessage({
          tone: 'success',
          text:
            result.value.changed.length === 0
              ? t('integration.noChanges')
              : result.value.reverify
                ? t('integration.savedNeedsTest')
                : t('integration.saved'),
        });
        router.refresh();
        return;
      }
      refusal(result.error);
    });
  }

  function onToggle(enabled: boolean) {
    if (!saved) return;
    setMessage(null);
    startTransition(async () => {
      const result = await setTenantEmailEnabledAction({ enabled, version: saved.version });
      if (result.ok) {
        setMessage({
          tone: 'success',
          text: t(enabled ? 'integration.switchedOn' : 'integration.switchedOff'),
        });
        router.refresh();
        return;
      }
      refusal(result.error);
    });
  }

  function onSendTest(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecipientError(undefined);
    startTransition(async () => {
      const result = await requestTenantEmailTestAction({ recipient });
      if (result.ok) {
        setTestOpen(false);
        setRecipient('');
        setMessage({ tone: 'info', text: t('integration.testQueued') });
        router.refresh();
        return;
      }
      if (result.error.fieldErrors?.some((f) => f.path === 'recipient')) {
        setRecipientError(t('fieldInvalid'));
        return;
      }
      setTestOpen(false);
      refusal(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="email-integration-status"
        className={`flex flex-wrap items-center justify-between gap-4 rounded-lg border border-s-4 p-4 ${
          ownActive || props.platformSenderVerified
            ? 'border-success bg-success-subtle'
            : 'border-warning bg-warning-subtle'
        }`}
        data-testid="email-integration-status"
        data-sender={ownActive ? 'organization' : 'platform'}
      >
        <div className="min-w-0">
          <h2 id="email-integration-status" className="m-0 text-base font-semibold">
            {ownActive ? t('integration.statusOwnTitle') : t('integration.statusPlatformTitle')}
          </h2>
          <p className="m-0 text-sm">
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
        {saved && props.editable ? (
          <div className="flex flex-col items-start gap-1">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                role="switch"
                className="size-5 accent-primary"
                checked={ownActive}
                disabled={pending || (!ownActive && !saved.verified)}
                aria-describedby="email-integration-switch-hint"
                onChange={(event) => {
                  onToggle(event.target.checked);
                }}
                data-testid="email-integration-enabled"
              />
              {t('integration.switchLabel')}
            </label>
            <p id="email-integration-switch-hint" className="m-0 max-w-72 text-xs text-text-muted">
              {saved.verified ? t('integration.switchHint') : t('integration.switchNeedsTest')}
            </p>
          </div>
        ) : null}
      </section>

      {message ? (
        <Alert tone={message.tone} data-testid="email-integration-message">
          {message.text}
        </Alert>
      ) : null}

      <Card
        aria-labelledby="email-integration-provider"
        titleId="email-integration-provider"
        title={t('integration.providerTitle')}
        description={t('integration.providerIntro')}
        icon="mail"
        className="flex flex-col gap-5 *:first:mb-0"
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={onSave}
          noValidate
          data-testid="email-integration-form"
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
          <fieldset className="m-0 flex flex-col gap-4 border-0 border-t border-border p-0 pt-5">
            <legend className="mb-4 p-0 font-semibold">{t('sender.title')}</legend>
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
          </fieldset>
          {props.editable ? (
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={disabled} data-testid="email-integration-save">
                {pending ? t('integration.saving') : t('integration.save')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || !saved}
                title={saved ? undefined : t('integration.saveFirst')}
                onClick={() => {
                  setTestOpen(true);
                }}
                data-testid="email-integration-send-test"
              >
                {t('integration.sendTest')}
              </Button>
            </div>
          ) : null}
        </form>
      </Card>

      <Dialog
        open={testOpen}
        onClose={() => {
          setTestOpen(false);
        }}
        title={t('integration.testDialogTitle')}
        description={t('integration.testDialogIntro')}
        closeLabel={t('integration.testCancel')}
        size="sm"
        data-testid="email-test-dialog"
      >
        <form className="flex flex-col gap-4" onSubmit={onSendTest} noValidate>
          <TextField
            id="email-test-recipient"
            name="recipient"
            type="email"
            dir="ltr"
            autoComplete="email"
            label={t('integration.testRecipient')}
            marker={t('provider.required')}
            error={recipientError}
            value={recipient}
            onChange={(event) => {
              setRecipient(event.target.value);
            }}
            data-testid="email-test-recipient"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setTestOpen(false);
              }}
            >
              {t('integration.testCancel')}
            </Button>
            <Button
              type="submit"
              disabled={pending || recipient.trim() === ''}
              data-testid="email-test-send"
            >
              {t('integration.testSend')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
