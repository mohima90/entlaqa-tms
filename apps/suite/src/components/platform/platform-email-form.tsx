'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert, Button, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useState, useTransition } from 'react';
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
 * PlatformEmailClient) as three numbered steps (redesign package 5, PO 21 Oct 2026): ① Provider (the
 * provider and its fields, secrets write-only), ② Sender details (address and name), ③ Send a test e-mail
 * (the latest test line, the recipient and «حفظ وإرسال رسالة تجريبية» / Save and send test — still ONE
 * button, PO 21 Oct 2026). Saving makes the sender unverified until the worker has sent the test (the
 * status card above says so; the page refreshes itself meanwhile). Saved → a toast; refusals stay an
 * alert in the form.
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
  /** The latest test e-mail's line (server-rendered), shown in step 3 next to the button that sends it. */
  readonly testLine?: ReactNode;
}

interface Message {
  readonly tone: 'danger';
  readonly text: string;
}

/** A numbered step of the configure card. */
function Step({
  number,
  title,
  id,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly id: string;
  readonly children: ReactNode;
}) {
  return (
    <li
      aria-labelledby={id}
      className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-b border-dashed border-border py-5 last:border-b-0 md:grid-cols-[40px_minmax(0,1fr)] md:gap-4.5 md:py-5.5"
    >
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-full border-[1.5px] border-primary/40 bg-primary-subtle font-bold text-primary-text md:size-10"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-col gap-4">
        <h3 id={id} className="m-0 pt-0.5 text-lg font-bold md:pt-1.5">
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

export function PlatformEmailForm({
  saved,
  keyReady,
  texts,
  errors,
  testLine,
}: PlatformEmailFormProps) {
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
        toast.success(t('platform.saved'));
        router.refresh();
        return;
      }
      refusal(result.error);
    });
  }

  return (
    <section
      aria-labelledby="platform-email-configure"
      className="rounded-xl border border-border bg-surface shadow-1"
    >
      <header className="border-b border-border px-5 pb-4 pt-5 md:px-7 md:pt-6">
        <h2 id="platform-email-configure" className="m-0 text-[22px] font-bold">
          {t('platform.configureTitle')}
        </h2>
        <p className="m-0 mt-1.5 text-text-muted">{t('platform.configureIntro')}</p>
      </header>
      <form
        onSubmit={onSubmit}
        noValidate
        data-testid="platform-email-form"
        className="px-5 pb-3 md:px-7"
      >
        {message ? (
          <Alert tone={message.tone} className="mt-5" data-testid="platform-email-message">
            {message.text}
          </Alert>
        ) : null}
        <ol className="m-0 list-none p-0">
          <Step number={1} id="platform-email-step-provider" title={t('provider.label')}>
            <ProviderFields
              idPrefix="platform-email"
              values={provider}
              onChange={setProvider}
              disabled={disabled}
              secretState={secretState}
              errors={fieldErrors}
              texts={texts}
            />
          </Step>
          <Step number={2} id="platform-email-step-sender" title={t('sender.title')}>
            <div className="grid grid-cols-1 gap-4.5 md:grid-cols-2">
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
            </div>
          </Step>
          <Step number={3} id="platform-email-step-test" title={t('integration.testDialogTitle')}>
            {testLine}
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-60 flex-1">
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
              <Button
                type="submit"
                busy={pending}
                disabled={disabled}
                className="max-md:w-full"
                data-testid="platform-email-save"
              >
                {pending ? t('platform.saving') : t('platform.save')}
              </Button>
            </div>
          </Step>
        </ol>
      </form>
    </section>
  );
}
