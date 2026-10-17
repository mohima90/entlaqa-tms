'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert, Button, Card, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { savePlatformEmailSettingsAction } from '../../auth/platform-console';
import {
  type ProviderFormValues,
  fieldOfPath,
  providerFormValues,
  providerInput,
  secretStateFor,
} from '../../lib/email-settings-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { ProviderFields } from '../email/provider-fields';

/**
 * Platform settings → Email «مرسِل البريد» / Email sender — the configure card (WP-ADM-01; Kawadir's
 * PlatformEmailClient): provider, its fields (secrets write-only), sender address and name, the test
 * recipient, «حفظ وإرسال رسالة تجريبية» / Save and send test. Saving makes the sender unverified until the
 * worker has sent the test (the status card above says so; the page refreshes itself meanwhile).
 */
export interface PlatformEmailFormProps {
  readonly saved: {
    readonly provider: string;
    readonly options: Record<string, unknown>;
    readonly credentialsCurrent: boolean;
    readonly fromName: string;
    readonly fromAddress: string;
    readonly version: number;
  } | null;
  /** The worker has published its key: secrets can be saved. */
  readonly keyReady: boolean;
  /** emailSettings texts, flattened. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

interface Message {
  readonly tone: 'success' | 'danger';
  readonly text: string;
}

export function PlatformEmailForm({ saved, keyReady, texts, errors }: PlatformEmailFormProps) {
  const t = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [provider, setProvider] = useState<ProviderFormValues>(providerFormValues(saved));
  const [fromName, setFromName] = useState(saved?.fromName ?? 'Jadarat');
  const [fromAddress, setFromAddress] = useState(saved?.fromAddress ?? '');
  const [testTo, setTestTo] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [version, setVersion] = useState<number | null>(saved?.version ?? null);
  const secretState = secretStateFor(saved, provider);
  const disabled = pending || !keyReady;

  function refusal(error: AppError) {
    const found: Record<string, string> = {};
    for (const fieldError of error.fieldErrors ?? []) {
      const field = fieldOfPath(fieldError.path, provider.provider);
      found[field] ??= t('fieldInvalid');
    }
    setFieldErrors(found);
    const formCode = error.fieldErrors?.find((f) => f.path === 'form')?.code;
    const text =
      error.code === 'CONFLICT_VERSION'
        ? t('conflict')
        : formCode === 'TOO_SOON'
          ? t('testTooSoon')
          : formCode === 'KEY_CHANGED'
            ? t('keyChanged')
            : formCode === 'NOT_SET_UP'
              ? t('platform.keyMissing')
              : errorText(error, errors);
    setMessage({ tone: 'danger', text });
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await savePlatformEmailSettingsAction({
        version,
        provider: providerInput(provider, secretState === 'saved'),
        fromName,
        fromAddress,
        testTo,
      });
      if (result.ok) {
        setVersion(result.value.version);
        setProvider((current) => ({
          ...current,
          apiKey: '',
          smtpPassword: '',
          graphClientSecret: '',
        }));
        setMessage({ tone: 'success', text: t('platform.saved') });
        router.refresh();
        return;
      }
      refusal(result.error);
    });
  }

  return (
    <Card
      aria-labelledby="platform-email-configure"
      titleId="platform-email-configure"
      title={t('platform.configureTitle')}
      description={t('platform.configureIntro')}
      icon="mail"
      className="flex flex-col gap-5 *:first:mb-0"
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={onSubmit}
        noValidate
        data-testid="platform-email-form"
      >
        {message ? (
          <Alert tone={message.tone} data-testid="platform-email-message">
            {message.text}
          </Alert>
        ) : null}
        <ProviderFields
          idPrefix="platform-email"
          values={provider}
          onChange={setProvider}
          disabled={disabled}
          secretState={secretState}
          errors={fieldErrors}
          texts={texts}
        />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-5">
          <TextField
            id="platform-email-fromAddress"
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
            data-testid="platform-email-fromAddress"
          />
          <TextField
            id="platform-email-fromName"
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
            data-testid="platform-email-fromName"
          />
          <TextField
            id="platform-email-testTo"
            name="testTo"
            type="email"
            dir="ltr"
            autoComplete="email"
            label={t('platform.testTo')}
            marker={t('provider.required')}
            error={fieldErrors.testTo}
            value={testTo}
            onChange={(event) => {
              setTestTo(event.target.value);
            }}
            disabled={disabled}
            data-testid="platform-email-testTo"
          />
        </div>
        <div>
          <Button type="submit" disabled={disabled} data-testid="platform-email-save">
            {pending ? t('platform.saving') : t('platform.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
