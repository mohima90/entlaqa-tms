'use client';
import { imageSize } from '@jadarat/platform-files/images';
import { Alert, Button, Card, Icon, TextField, cn } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import {
  confirmBrandImageUploadAction,
  saveBrandingAction,
  startBrandImageUploadAction,
} from '../../actions/organization';
import {
  type SlotState,
  afterSave,
  beginPick,
  initialSlot,
  removed,
  saveRefused,
  uploadConfirmed,
  uploadFailed,
} from '../../lib/brand-image-slot';
import {
  BRAND_PRESETS,
  type BrandColors,
  JADARAT_BRAND,
  brandProperties,
  contrastChecks,
  displayRatio,
  parseBrandColor,
  sniffImageType,
  websiteLooksValid,
} from '../../lib/branding-view';
import { fillText } from '../../lib/fill-text';
import { cleanName, validateOrganizationName } from '../../lib/organization-profile-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';

/**
 * Organization → Branding (WP-ADM-02, FR-ADM-07; business flow EP-BRAND; Kawadir /org/branding): the
 * organization's names, logo, browser icon, sign-in picture, primary and secondary colour with «Use
 * gradient», preset colours (Jadarat first), website — and a live preview of the menu, a main button and
 * the sign-in page with the UNSAVED choices. A real WCAG 2.2 AA contrast check warns about hard-to-read
 * colours (saving stays possible). Images: PNG, JPG or WebP only (checked by name, size, first bytes and size
 * in pixels here; by content and in pixels again on the server when saving, which removes their metadata
 * and publishes them — not virus-scanned, PO 20 Oct 2026, like Kawadir: they show as soon as the save is
 * done); uploaded at once, used once saved. A failed replacement puts the image the slot had back
 * (lib/brand-image-slot.ts). Progress and results are announced politely (aria-live). «Reset to the
 * Jadarat look» puts the Jadarat colours back (images stay unless removed).
 *
 * The CSP allows no style attributes: colours reach the preview and the swatches through CSS custom
 * properties set with the CSSOM after hydration (preset swatches are static classes).
 */

export type BrandSlot = 'logo' | 'favicon' | 'sign_in_image';
const SLOTS: readonly BrandSlot[] = ['logo', 'favicon', 'sign_in_image'];

export interface BrandImageInitial {
  readonly fileId: string;
  /** The published copy (/api/brand/<id>), or null when it is not published (yet). */
  readonly src: string | null;
  /** The file's status (for its uploader), or null. */
  readonly status: string | null;
  readonly name: string | null;
  /** The worker gave up publishing it: the page asks for another image. */
  readonly failed: boolean;
}

export interface BrandingFormValues {
  readonly nameEn: string;
  readonly nameAr: string;
  /** As typed (#RRGGBB when valid). */
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly useGradient: boolean;
  readonly websiteUrl: string;
}

export interface BrandingFormProps {
  readonly locale: 'ar' | 'en';
  /** Sign-in and database configured: uploads and saving work. Otherwise the page is a preview. */
  readonly live: boolean;
  readonly editable: boolean;
  readonly version: number;
  readonly initial: BrandingFormValues;
  readonly images: Readonly<Record<BrandSlot, BrandImageInitial | null>>;
  /** Largest file per slot, in bytes (platform-files purposes). */
  readonly limits: Readonly<Record<BrandSlot, number>>;
  /** Largest side per slot, in pixels (platform-files BRAND_IMAGE_MAX_SIDE). */
  readonly maxSides: Readonly<Record<BrandSlot, number>>;
  /** Translated texts by key (branding namespace, flattened). */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly lastChanged: string;
}

interface Message {
  readonly tone: 'success' | 'warning' | 'danger' | 'info';
  readonly text: string;
}

type Field = 'nameEn' | 'nameAr' | 'primaryColor' | 'secondaryColor' | 'websiteUrl';

/** Static classes of the preset swatches (the CSP allows no style attribute; Tailwind sees these). */
const PRESET_CLASSES: Readonly<Record<string, string>> = {
  jadarat: 'bg-[linear-gradient(135deg,#2F4858,#33658A)]',
  teal: 'bg-[linear-gradient(135deg,#0F5E4E,#13806A)]',
  navy: 'bg-[linear-gradient(135deg,#1E3A5F,#2C5282)]',
  burgundy: 'bg-[linear-gradient(135deg,#7A1F2B,#9B2C3A)]',
  plum: 'bg-[linear-gradient(135deg,#4B2C5E,#6B3F86)]',
  forest: 'bg-[linear-gradient(135deg,#2D5A27,#3B7333)]',
  charcoal: 'bg-[linear-gradient(135deg,#2B2F33,#4A5056)]',
};

/** The field errors without the colours' (after a preset or «Reset»). */
function withoutColorErrors(
  current: Partial<Record<Field, string>>,
): Partial<Record<Field, string>> {
  const { primaryColor: _primary, secondaryColor: _secondary, ...rest } = current;
  return rest;
}

/** The colours the previews use: the last valid ones as typed (the Jadarat ones until then). */
function validColors(values: BrandingFormValues): BrandColors {
  const primary = parseBrandColor(values.primaryColor) ?? JADARAT_BRAND.primary;
  const secondary = parseBrandColor(values.secondaryColor) ?? primary;
  return { primaryColor: primary, secondaryColor: secondary, useGradient: values.useGradient };
}

/** Light or dark, as the page shows it now (the app's choice, else the system's). */
function currentMode(): 'light' | 'dark' {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Follows the page's light / dark mode (the theme menu sets data-theme; else the system's). */
function subscribeMode(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onChange);
  };
}

/** Sets CSS custom properties on an element (CSSOM: allowed by the CSP, unlike style attributes). */
function useCssVariables(variables: Readonly<Record<string, string>>) {
  const ref = useRef<HTMLDivElement & HTMLSpanElement>(null);
  const key = JSON.stringify(variables);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    for (const [name, value] of Object.entries(JSON.parse(key) as Record<string, string>)) {
      element.style.setProperty(name, value);
    }
  }, [key]);
  return ref;
}

/** A square showing one colour (the chosen primary or secondary). */
function ColorSwatch({ color }: { readonly color: string }) {
  const ref = useCssVariables({ '--swatch': color });
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="size-11 shrink-0 rounded-xl border-2 border-border bg-(--swatch) shadow-1"
    />
  );
}

function ColorField({
  id,
  label,
  value,
  error,
  disabled,
  texts,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly disabled: boolean;
  readonly texts: { readonly hex: string; readonly picker: string };
  readonly onChange: (value: string) => void;
}) {
  const valid = parseBrandColor(value);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-text" id={`${id}-label`}>
        {label}
      </span>
      <div className="flex flex-wrap items-end gap-3">
        <ColorSwatch color={valid ?? '#FFFFFF'} />
        <input
          type="color"
          aria-label={texts.picker}
          value={(valid ?? '#000000').toLowerCase()}
          onChange={(event) => {
            onChange(event.target.value.toUpperCase());
          }}
          disabled={disabled}
          className="h-11 w-14 cursor-pointer rounded-xl border border-border-strong bg-surface p-1"
          data-testid={`${id}-picker`}
        />
        <div className="w-40">
          <TextField
            id={id}
            label={texts.hex}
            dir="ltr"
            lang="en"
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            value={value}
            error={error}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            disabled={disabled}
            className="font-mono"
            data-testid={id}
          />
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number, locale: 'ar' | 'en'): string {
  const mb = bytes / (1024 * 1024);
  const format = new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 1 });
  if (mb >= 1) return locale === 'ar' ? `${format.format(mb)} ميجابايت` : `${format.format(mb)} MB`;
  const kb = bytes / 1024;
  return locale === 'ar' ? `${format.format(kb)} كيلوبايت` : `${format.format(kb)} KB`;
}

export function BrandingForm(props: BrandingFormProps) {
  const { texts, editable, live, locale } = props;
  const t = useCallback((key: string) => texts[key] ?? key, [texts]);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<BrandingFormValues>(props.initial);
  const [slots, setSlots] = useState<Record<BrandSlot, SlotState>>(() => ({
    logo: initialSlot(props.images.logo),
    favicon: initialSlot(props.images.favicon),
    sign_in_image: initialSlot(props.images.sign_in_image),
  }));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [savedVersion, setSavedVersion] = useState(props.version);
  // After a save the page's data is refreshed: the slots then show what was published (or that an image
  // is not shown yet) instead of the picked files.
  const [shownVersion, setShownVersion] = useState(props.version);
  if (props.version !== shownVersion) {
    setShownVersion(props.version);
    setSlots({
      logo: initialSlot(props.images.logo),
      favicon: initialSlot(props.images.favicon),
      sign_in_image: initialSlot(props.images.sign_in_image),
    });
  }
  const version = Math.max(props.version, savedVersion);
  const disabled = !editable || pending;
  const inputs = useRef<Partial<Record<BrandSlot, HTMLInputElement | null>>>({});
  const blobs = useRef(new Set<string>());

  useEffect(() => {
    const owned = blobs.current;
    return () => {
      for (const url of owned) URL.revokeObjectURL(url);
    };
  }, []);

  const colors = validColors(values);
  const mode = useSyncExternalStore(subscribeMode, currentMode, () => 'light' as const);
  const previewRef = useCssVariables(brandProperties(colors, mode));

  const set = <K extends keyof BrandingFormValues>(field: K, value: BrandingFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
  };
  const updateSlot = (slot: BrandSlot, change: (state: SlotState) => SlotState) => {
    setSlots((current) => ({ ...current, [slot]: change(current[slot]) }));
  };
  /** A refusal before anything is uploaded: the slot keeps what it shows, with the reason. */
  const refuse = (slot: BrandSlot, error: string) => {
    updateSlot(slot, (state) => ({ ...state, error }));
  };

  /** Header only (no decoding): the size in pixels within the slot's cap? Else the refusal's text. */
  async function pixelProblem(slot: BrandSlot, file: File): Promise<string | null> {
    const size = imageSize(new Uint8Array(await file.arrayBuffer()));
    if (size === null) return t('images.errorType');
    const max = props.maxSides[slot];
    if (size.width <= max && size.height <= max) return null;
    return fillText(t('images.errorDimensions'), { size: String(max) }, locale);
  }

  /** Why the save refused a slot's image (field error code), in the page's words. */
  function imageRefusal(slot: BrandSlot, code: string): string {
    switch (code) {
      case 'IMAGE_TYPE_NOT_ALLOWED':
        return t('images.errorType');
      case 'IMAGE_TOO_LARGE':
        return fillText(
          t('images.errorSize'),
          { size: formatBytes(props.limits[slot], locale) },
          locale,
        );
      case 'IMAGE_EMPTY':
        return t('images.errorEmpty');
      case 'IMAGE_DIMENSIONS_TOO_LARGE':
        return fillText(
          t('images.errorDimensions'),
          { size: String(props.maxSides[slot]) },
          locale,
        );
      case 'IMAGE_MALFORMED':
        return t('images.errorDamaged');
      default:
        return t('images.errorNotUsable');
    }
  }

  async function pick(slot: BrandSlot, file: File) {
    setMessage(null);
    const limit = props.limits[slot];
    const typeError = t('images.errorType');
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
      refuse(slot, typeError);
      return;
    }
    if (file.size === 0) {
      refuse(slot, t('images.errorEmpty'));
      return;
    }
    if (file.size > limit) {
      refuse(slot, fillText(t('images.errorSize'), { size: formatBytes(limit, locale) }, locale));
      return;
    }
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (sniffImageType(head) === null) {
      refuse(slot, typeError);
      return;
    }
    const pixels = await pixelProblem(slot, file);
    if (pixels !== null) {
      refuse(slot, pixels);
      return;
    }
    const src = URL.createObjectURL(file);
    blobs.current.add(src);
    if (!live || !editable) {
      updateSlot(slot, (state) => beginPick(state, { src, name: file.name }, 'previewOnly'));
      return;
    }
    updateSlot(slot, (state) => beginPick(state, { src, name: file.name }, 'uploading'));
    // Any failure from here on puts the image the slot had back (security review M3).
    const fail = (error: string) => {
      updateSlot(slot, (state) => uploadFailed(state, src, error));
    };
    const started = await startBrandImageUploadAction({
      slot,
      fileName: file.name,
      size: file.size,
    });
    if (!started.ok) {
      fail(errorText(started.error, props.errors));
      sessionRefused(started.error);
      return;
    }
    const target = started.value;
    let put: Response;
    try {
      put = await fetch(target.url, {
        method: target.method,
        body: file,
        headers: { 'Content-Type': target.contentType },
      });
    } catch {
      put = new Response(null, { status: 599 });
    }
    if (!put.ok) {
      fail(t('images.errorUpload'));
      return;
    }
    const confirmed = await confirmBrandImageUploadAction({ slot, fileId: target.fileId });
    if (!confirmed.ok) {
      fail(errorText(confirmed.error, props.errors));
      sessionRefused(confirmed.error);
      return;
    }
    // Empty, too large or stored with another type (Storage's facts): refused at once.
    if (!['uploaded', 'accepted', 'clean'].includes(confirmed.value.status)) {
      fail(t('images.errorRejected'));
      return;
    }
    updateSlot(slot, (state) => uploadConfirmed(state, src, target.fileId));
  }

  function remove(slot: BrandSlot) {
    setMessage(null);
    updateSlot(slot, removed);
  }

  function reset() {
    setValues((current) => ({
      ...current,
      primaryColor: JADARAT_BRAND.primary,
      secondaryColor: JADARAT_BRAND.secondary,
      useGradient: true,
    }));
    setFieldErrors(withoutColorErrors);
    setMessage({ tone: 'info', text: t('colors.resetDone') });
  }

  function validate(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    for (const field of ['nameEn', 'nameAr'] as const) {
      const problem = validateOrganizationName(values[field]);
      if (problem) errors[field] = t(`fieldErrors.${problem}`);
    }
    if (!parseBrandColor(values.primaryColor)) errors.primaryColor = t('colors.hexInvalid');
    if (values.useGradient && !parseBrandColor(values.secondaryColor)) {
      errors.secondaryColor = t('colors.hexInvalid');
    }
    if (!websiteLooksValid(values.websiteUrl)) errors.websiteUrl = t('website.invalid');
    return errors;
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const found = validate();
    setFieldErrors(found);
    const first = (
      ['nameEn', 'nameAr', 'primaryColor', 'secondaryColor', 'websiteUrl'] as const
    ).find((field) => found[field] !== undefined);
    if (first) {
      document.getElementById(`brand-${first}`)?.focus();
      setMessage({ tone: 'danger', text: props.errors['errors.validationFailed'] ?? '' });
      return;
    }
    if (!live) {
      setMessage({ tone: 'info', text: t('notConfigured') });
      return;
    }
    const primary = parseBrandColor(values.primaryColor) ?? JADARAT_BRAND.primary;
    startTransition(async () => {
      const result = await saveBrandingAction({
        version,
        nameEn: cleanName(values.nameEn),
        nameAr: cleanName(values.nameAr),
        primaryColor: primary,
        secondaryColor: values.useGradient
          ? (parseBrandColor(values.secondaryColor) ?? primary)
          : primary,
        useGradient: values.useGradient,
        websiteUrl: values.websiteUrl.trim(),
        logoFileId: slots.logo.fileId,
        faviconFileId: slots.favicon.fileId,
        signInImageFileId: slots.sign_in_image.fileId,
      });
      if (result.ok) {
        setSavedVersion(result.value.version);
        setSlots((current) => ({
          logo: afterSave(current.logo),
          favicon: afterSave(current.favicon),
          sign_in_image: afterSave(current.sign_in_image),
        }));
        setMessage({
          tone: 'success',
          text: result.value.changed.length === 0 ? t('noChanges') : t('saved'),
        });
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'VALIDATION_FAILED') {
        const fromServer: Partial<Record<Field, string>> = {};
        for (const fieldError of result.error.fieldErrors ?? []) {
          const path = fieldError.path;
          const slot = SLOTS.find(
            (s) =>
              path ===
              (
                {
                  logo: 'logoFileId',
                  favicon: 'faviconFileId',
                  sign_in_image: 'signInImageFileId',
                } as const
              )[s],
          );
          if (slot) {
            const reason = imageRefusal(slot, fieldError.code);
            updateSlot(slot, (state) => saveRefused(state, reason));
          } else if (path === 'websiteUrl') fromServer.websiteUrl = t('website.invalid');
          else if (path === 'nameEn' || path === 'nameAr')
            fromServer[path] = t('fieldErrors.nameInvalid');
          else if (path === 'primaryColor' || path === 'secondaryColor') {
            fromServer[path] = t('colors.hexInvalid');
          }
        }
        setFieldErrors(fromServer);
      }
      setMessage({ tone: 'danger', text: errorText(result.error, props.errors) });
    });
  }

  function cancel() {
    setValues(props.initial);
    setSlots({
      logo: initialSlot(props.images.logo),
      favicon: initialSlot(props.images.favicon),
      sign_in_image: initialSlot(props.images.sign_in_image),
    });
    setFieldErrors({});
    setMessage(null);
  }

  const checks = contrastChecks(colors);
  const failing = checks.filter((check) => !check.pass);
  const name =
    (locale === 'ar' ? values.nameAr : values.nameEn).trim() || values.nameEn || values.nameAr;

  const slotLabel: Readonly<Record<BrandSlot, string>> = {
    logo: t('images.logo'),
    favicon: t('images.favicon'),
    sign_in_image: t('images.signInImage'),
  };
  const slotHint: Readonly<Record<BrandSlot, string>> = {
    logo: t('images.logoHint'),
    favicon: t('images.faviconHint'),
    sign_in_image: t('images.signInImageHint'),
  };

  function imageNote(state: SlotState): ReactNode {
    const text =
      state.phase === 'uploading'
        ? t('images.uploading')
        : state.phase === 'ready'
          ? t('images.ready')
          : state.phase === 'previewOnly'
            ? t('images.previewOnly')
            : state.phase === 'saved'
              ? state.src
                ? t('images.published')
                : t('images.pendingPublish')
              : null;
    return text ? <span className="text-xs text-text-muted">{text}</span> : null;
  }

  /** The slot's problem: the last refusal, or a saved image the worker could not prepare. */
  const slotError = (state: SlotState) =>
    state.error ?? (state.failed ? t('images.errorNotPublished') : null);

  const imageSlot = (slot: BrandSlot) => {
    const state = slots[slot];
    const id = `brand-image-${slot}`;
    return (
      <div className="flex flex-col gap-2" data-testid={`brand-slot-${slot}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-text" id={`${id}-label`}>
            {slotLabel[slot]}
          </span>
        </div>
        <p className="m-0 text-xs text-text-muted" id={`${id}-hint`}>
          {slotHint[slot]}
        </p>
        <input
          ref={(element) => {
            inputs.current[slot] = element;
          }}
          id={id}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pick(slot, file);
          }}
          data-testid={`${id}-input`}
        />
        <div
          className={cn(
            'flex flex-wrap items-center gap-4 rounded-xl p-4',
            state.src || state.fileId
              ? 'bg-surface-sunken'
              : 'border-2 border-dashed border-border-strong',
          )}
        >
          {state.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- a preview (blob:) or a same-origin copy
            <img
              src={state.src}
              alt={slotLabel[slot]}
              className={cn(
                'object-contain',
                slot === 'favicon'
                  ? 'size-8'
                  : slot === 'logo'
                    ? 'max-h-16 max-w-32'
                    : 'h-24 w-40 rounded-lg object-cover',
              )}
              data-testid={`${id}-preview`}
            />
          ) : (
            <Icon name="palette" className="size-8 text-text-subtle" />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {state.name ? (
              <span className="truncate text-sm text-text" dir="auto">
                {fillText(t('images.chosen'), { name: state.name }, locale)}
              </span>
            ) : null}
            {/* Progress is announced politely as it changes (security review L12). */}
            <div aria-live="polite" aria-atomic="true" data-testid={`${id}-status`}>
              {imageNote(state)}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || state.phase === 'uploading'}
              onClick={() => inputs.current[slot]?.click()}
              aria-describedby={`${id}-hint`}
              data-testid={`${id}-upload`}
            >
              <Icon name="plus" />
              {state.src || state.fileId ? t('images.replace') : t('images.upload')}
              <span className="sr-only"> · {slotLabel[slot]}</span>
            </Button>
            {state.src || state.fileId ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  remove(slot);
                }}
                data-testid={`${id}-remove`}
              >
                <Icon name="trash" />
                {t('images.remove')}
                <span className="sr-only"> · {slotLabel[slot]}</span>
              </Button>
            ) : null}
          </div>
        </div>
        <div aria-live="polite" aria-atomic="true">
          {slotError(state) ? (
            <p className="m-0 text-sm text-danger-text" data-testid={`${id}-error`}>
              {slotError(state)}
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  const logoSrc = slots.logo.src;
  const signInSrc = slots.sign_in_image.src;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={onSubmit}
      noValidate
      data-testid="branding-form"
    >
      {/* Results are announced politely as they appear (security review L12). */}
      <div aria-live="polite" aria-atomic="true">
        {message ? (
          <Alert tone={message.tone} data-testid="branding-message">
            {message.text}
          </Alert>
        ) : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title={t('names.title')}
          titleId="brand-card-names"
          aria-labelledby="brand-card-names"
          description={t('names.intro')}
          icon="building"
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4">
            <TextField
              id="brand-nameEn"
              dir="ltr"
              lang="en"
              autoComplete="organization"
              label={t('names.nameEn')}
              hint={t('names.hint')}
              error={fieldErrors.nameEn}
              value={values.nameEn}
              onChange={(event) => {
                set('nameEn', event.target.value);
              }}
              disabled={disabled}
              data-testid="brand-nameEn"
            />
            <TextField
              id="brand-nameAr"
              dir="rtl"
              lang="ar"
              label={t('names.nameAr')}
              hint={t('names.hint')}
              error={fieldErrors.nameAr}
              value={values.nameAr}
              onChange={(event) => {
                set('nameAr', event.target.value);
              }}
              disabled={disabled}
              data-testid="brand-nameAr"
            />
          </div>
        </Card>

        <Card
          title={t('images.title')}
          titleId="brand-card-images"
          aria-labelledby="brand-card-images"
          description={t('images.intro')}
          icon="palette"
          className="flex flex-col gap-5"
        >
          {imageSlot('logo')}
          {imageSlot('favicon')}
        </Card>

        <Card
          title={t('images.signInImage')}
          titleId="brand-card-sign-in"
          aria-labelledby="brand-card-sign-in"
          description={t('images.intro')}
          icon="monitor"
          className="flex flex-col gap-5 lg:col-span-2"
        >
          {imageSlot('sign_in_image')}
        </Card>

        <Card
          title={t('colors.title')}
          titleId="brand-card-colors"
          aria-labelledby="brand-card-colors"
          description={t('colors.intro')}
          icon="palette"
          className="flex flex-col gap-5"
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={disabled}
              data-testid="brand-reset"
            >
              <Icon name="repeat" />
              {t('colors.reset')}
            </Button>
          }
        >
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-sunken p-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-text" id="brand-gradient-label">
                {t('colors.useGradient')}
              </span>
              <span className="text-xs text-text-muted" id="brand-gradient-hint">
                {values.useGradient ? t('colors.gradientOnHint') : t('colors.gradientOffHint')}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={values.useGradient}
              aria-labelledby="brand-gradient-label"
              aria-describedby="brand-gradient-hint"
              disabled={disabled}
              onClick={() => {
                set('useGradient', !values.useGradient);
              }}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                values.useGradient ? 'bg-primary' : 'bg-border-strong',
              )}
              data-testid="brand-gradient"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-block size-6 rounded-full bg-surface shadow-1 transition-transform',
                  values.useGradient ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
          </div>

          <ColorField
            id="brand-primaryColor"
            label={values.useGradient ? t('colors.primary') : t('colors.brandColor')}
            value={values.primaryColor}
            error={fieldErrors.primaryColor}
            disabled={disabled}
            texts={{
              hex: fillText(t('colors.hexLabel'), {
                name: values.useGradient ? t('colors.primary') : t('colors.brandColor'),
              }),
              picker: fillText(t('colors.pickerLabel'), {
                name: values.useGradient ? t('colors.primary') : t('colors.brandColor'),
              }),
            }}
            onChange={(value) => {
              set('primaryColor', value);
            }}
          />
          {values.useGradient ? (
            <ColorField
              id="brand-secondaryColor"
              label={t('colors.secondary')}
              value={values.secondaryColor}
              error={fieldErrors.secondaryColor}
              disabled={disabled}
              texts={{
                hex: fillText(t('colors.hexLabel'), { name: t('colors.secondary') }),
                picker: fillText(t('colors.pickerLabel'), { name: t('colors.secondary') }),
              }}
              onChange={(value) => {
                set('secondaryColor', value);
              }}
            />
          ) : null}

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-medium text-text">
              {t('colors.presets')}
            </legend>
            <div className="flex flex-wrap gap-2">
              {BRAND_PRESETS.map((preset) => {
                const presetName = t(`presetNames.${preset.id}`);
                const chosen =
                  parseBrandColor(values.primaryColor) === preset.primary &&
                  (!values.useGradient ||
                    parseBrandColor(values.secondaryColor) === preset.secondary);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={chosen}
                    aria-label={fillText(t('colors.presetChoose'), { name: presetName })}
                    title={presetName}
                    disabled={disabled}
                    onClick={() => {
                      setValues((current) => ({
                        ...current,
                        primaryColor: preset.primary,
                        secondaryColor: preset.secondary,
                      }));
                      setFieldErrors(withoutColorErrors);
                    }}
                    className={cn(
                      'relative inline-flex size-11 items-center justify-center rounded-xl border-2 text-[#FFFFFF]',
                      chosen ? 'border-text' : 'border-transparent',
                      PRESET_CLASSES[preset.id],
                    )}
                    data-testid={`brand-preset-${preset.id}`}
                  >
                    {chosen ? <Icon name="check" className="size-5" /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {failing.length > 0 ? (
            <Alert
              tone="warning"
              title={t('colors.contrastTitle')}
              data-testid="brand-contrast-warning"
            >
              <p className="m-0 mb-2">{t('colors.contrastIntro')}</p>
              <ul className="m-0 flex list-disc flex-col gap-1 ps-5">
                {failing.map((check) => (
                  <li key={check.id} data-testid={`brand-contrast-${check.id}`}>
                    {fillText(
                      t(`colors.contrast${check.id.charAt(0).toUpperCase()}${check.id.slice(1)}`),
                      { ratio: displayRatio(check.ratio) },
                    )}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <p
              className="m-0 flex items-center gap-2 text-sm text-success-text"
              data-testid="brand-contrast-ok"
            >
              <Icon name="success" />
              {t('colors.contrastOk')}
            </p>
          )}
        </Card>

        <Card
          title={t('website.title')}
          titleId="brand-card-website"
          aria-labelledby="brand-card-website"
          description={t('website.intro')}
          icon="globe"
          className="flex flex-col gap-4"
        >
          <TextField
            id="brand-websiteUrl"
            type="url"
            dir="ltr"
            lang="en"
            inputMode="url"
            autoComplete="url"
            label={t('website.label')}
            hint={t('website.hint')}
            error={fieldErrors.websiteUrl}
            value={values.websiteUrl}
            placeholder="https://www.example.com"
            onChange={(event) => {
              set('websiteUrl', event.target.value);
            }}
            disabled={disabled}
            data-testid="brand-websiteUrl"
          />
        </Card>
      </div>

      <Card
        title={t('preview.title')}
        titleId="brand-card-preview"
        aria-labelledby="brand-card-preview"
        description={t('preview.intro')}
        icon="eye"
      >
        <div
          ref={previewRef}
          className="grid gap-4 md:grid-cols-[16rem_1fr]"
          data-testid="brand-preview"
        >
          {/* The menu, as the shell shows it. */}
          <div
            className="flex flex-col gap-2 rounded-xl border border-border bg-nav p-3"
            aria-hidden="true"
          >
            <div className="flex h-12 items-center px-2">
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- a preview (blob:) or a same-origin copy
                <img src={logoSrc} alt="" className="max-h-10 max-w-full object-contain" />
              ) : (
                <span className="text-brand-gradient truncate text-lg font-extrabold">{name}</span>
              )}
            </div>
            <span
              className="rounded-xl bg-brand-gradient px-3 py-2 text-sm font-medium text-on-nav-item-current shadow-brand-glow"
              data-testid="brand-preview-current"
            >
              {t('preview.menuHome')}
            </span>
            <span className="px-3 py-2 text-sm text-on-nav">{t('preview.menuTeam')}</span>
            <span className="px-3 py-2 text-sm text-on-nav">{t('preview.menuSettings')}</span>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="inline-flex min-h-9 items-center rounded-md bg-brand-gradient px-4 text-sm font-medium text-on-nav-item-current shadow-brand-glow"
                data-testid="brand-preview-button"
              >
                {t('preview.button')}
              </span>
              <span className="text-sm font-semibold text-primary-text">{t('website.title')}</span>
            </div>
            {/* The sign-in page: the form column and the brand panel with the picture. */}
            <div className="flex min-h-48 overflow-hidden rounded-xl border border-border bg-bg">
              <div className="flex flex-1 flex-col justify-center gap-2 p-4">
                {logoSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a preview (blob:) or a same-origin copy
                  <img
                    src={logoSrc}
                    alt={fillText(t('preview.logoAlt'), { name })}
                    className="max-h-8 max-w-32 object-contain"
                    data-testid="brand-preview-logo"
                  />
                ) : (
                  <span className="text-brand-gradient text-sm font-bold">{name}</span>
                )}
                <span className="text-sm font-semibold text-text">
                  {t('preview.signInWelcome')}
                </span>
                <span
                  aria-hidden="true"
                  className="h-6 rounded-md border border-border bg-surface"
                />
                <span
                  aria-hidden="true"
                  className="h-6 rounded-md border border-border bg-surface"
                />
                <span className="inline-flex h-7 items-center justify-center rounded-md bg-brand-gradient text-xs font-medium text-on-nav-item-current">
                  {t('preview.signInButton')}
                </span>
              </div>
              <div className="relative flex-1 bg-brand-panel" aria-hidden="true">
                {signInSrc ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a preview (blob:) or a same-origin copy */}
                    <img
                      src={signInSrc}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                    />
                    <span className="absolute inset-0 bg-brand-panel opacity-90" />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-2">
        <span className="text-sm text-text-muted" data-testid="branding-last-changed">
          {props.lastChanged}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={cancel}
            disabled={disabled}
            data-testid="branding-cancel"
          >
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={disabled} data-testid="branding-save">
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </form>
  );
}
