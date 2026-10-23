'use client';
import { Alert, Avatar, Button, Dialog, FormSection, Icon, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  confirmProfilePhotoUploadAction,
  removeProfilePhotoAction,
  saveProfilePhotoAction,
  startProfilePhotoUploadAction,
} from '../../actions/profile';
import { sniffImageType } from '../../lib/branding-view';
import { pickProblem } from '../../lib/profile-photo-crop';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from './field-errors';
import { PhotoCropDialog, type PhotoCropLabels } from './photo-crop-dialog';

export interface ProfilePhotoCardProps {
  /** The member's name: the picture's alternative text and the initials. */
  readonly name: string;
  /** The address of the photo (`/api/photo/<id>?v=…`), or null: initials. */
  readonly photoHref: string | null;
  /** Sign-in and database configured: the buttons work. Otherwise the card is a preview. */
  readonly live: boolean;
  readonly labels: {
    readonly title: string;
    readonly intro: string;
    readonly upload: string;
    readonly replace: string;
    readonly remove: string;
    readonly rules: string;
    readonly noPhoto: string;
    readonly errType: string;
    readonly errSize: string;
    readonly errNotUsable: string;
    readonly errUpload: string;
    readonly removeTitle: string;
    readonly removeText: string;
    readonly removeConfirm: string;
    readonly removed: string;
    readonly saved: string;
    readonly cancel: string;
    readonly close: string;
  };
  readonly crop: PhotoCropLabels;
  readonly errors: ErrorTexts;
}

/**
 * My profile → Photo (WP-ADM-04, FR-IAM-16; design S04-1/S04-2): the member adds, replaces or removes THEIR
 * OWN photo — nobody does it for someone else. Pick a PNG, JPEG or WebP (checked by its first bytes; SVG and
 * GIF refused), frame it, and it is shrunk in the browser, uploaded with the member's own session, checked
 * again by the server (type by content, size, pixels, hidden details removed) and shown at once — there is no
 * virus scan. Remove asks first. The top bar's picture and every list follow after the page refreshes.
 */
export function ProfilePhotoCard(props: ProfilePhotoCardProps) {
  const { labels, errors } = props;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const input = useRef<HTMLInputElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  // What the member just saved (or removed) shows at once; it applies to the address it was made on, so the
  // server's address takes over after the refresh.
  const [local, setLocal] = useState<{
    readonly base: string | null;
    readonly preview: string | null;
    readonly removed: boolean;
  } | null>(null);
  const current = local?.base === props.photoHref ? local : null;
  const preview = current?.preview ?? null;
  const removedNow = current?.removed === true;
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  // The server answered with a refusal: focus moves to it (WCAG 3.3.1, package 1 pattern).
  useEffect(() => {
    if (problem !== null) problemRef.current?.focus();
  }, [problem]);

  const src = removedNow ? undefined : (preview ?? props.photoHref ?? undefined);
  const hasPhoto = src !== undefined;

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    setProblem(null);
    if (!picked) return;
    // By content, not by name: the first bytes must be a PNG, JPEG or WebP.
    const head = new Uint8Array(await picked.slice(0, 16).arrayBuffer());
    const refusal = pickProblem(sniffImageType(head), picked.size);
    if (refusal !== null) {
      setProblem(refusal === 'size' ? labels.errSize : labels.errType);
      return;
    }
    setSaveError(null);
    setFile(picked);
  }

  function closeCrop() {
    if (saving) return;
    setFile(null);
    setSaveError(null);
  }

  /** Why the save was refused, as the dialog says it. */
  function refusalText(error: Parameters<typeof errorText>[0]): string {
    if (error.code === 'VALIDATION_FAILED') {
      const code = fieldErrorCodes(error).photo ?? '';
      if (code === 'IMAGE_TYPE_NOT_ALLOWED' || code === 'IMAGE_MALFORMED') return labels.errType;
      if (code === 'IMAGE_TOO_LARGE' || code === 'IMAGE_DIMENSIONS_TOO_LARGE')
        return labels.errSize;
      return labels.errNotUsable;
    }
    return errorText(error, errors);
  }

  async function save(blob: Blob) {
    if (!props.live) return;
    setSaving(true);
    setSaveError(null);
    try {
      const started = await startProfilePhotoUploadAction({
        fileName: 'photo.jpg',
        size: blob.size,
      });
      if (!started.ok) {
        if (!sessionRefused(started.error)) setSaveError(refusalText(started.error));
        return;
      }
      const target = started.value;
      let put: Response;
      try {
        put = await fetch(target.url, {
          method: target.method,
          body: blob,
          headers: { 'Content-Type': target.contentType },
        });
      } catch {
        put = new Response(null, { status: 599 });
      }
      if (!put.ok) {
        setSaveError(labels.errUpload);
        return;
      }
      const confirmed = await confirmProfilePhotoUploadAction({ fileId: target.fileId });
      if (!confirmed.ok) {
        if (!sessionRefused(confirmed.error)) setSaveError(refusalText(confirmed.error));
        return;
      }
      if (!['uploaded', 'accepted'].includes(confirmed.value.status)) {
        setSaveError(labels.errNotUsable);
        return;
      }
      const saved = await saveProfilePhotoAction({ fileId: target.fileId });
      if (!saved.ok) {
        if (!sessionRefused(saved.error)) setSaveError(refusalText(saved.error));
        return;
      }
      setLocal({ base: props.photoHref, preview: URL.createObjectURL(blob), removed: false });
      setFile(null);
      toast.success(labels.saved);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!props.live) return;
    setRemoving(true);
    try {
      const result = await removeProfilePhotoAction({});
      if (!result.ok) {
        if (!sessionRefused(result.error)) {
          setRemoveOpen(false);
          setProblem(errorText(result.error, errors));
        }
        return;
      }
      setRemoveOpen(false);
      setLocal({ base: props.photoHref, preview: null, removed: true });
      toast.success(labels.removed);
      router.refresh();
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <FormSection title={labels.title} description={labels.intro} className="mb-5.5">
        <div className="flex flex-col gap-4 md:col-span-2" data-testid="profile-photo">
          {problem ? (
            <div ref={problemRef} tabIndex={-1} className="outline-offset-2">
              <Alert tone="danger" data-testid="photo-problem">
                {problem}
              </Alert>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-5">
            <Avatar name={props.name} size="xl" src={src} alt={props.name} />
            <div className="flex min-w-56 flex-1 flex-col gap-3">
              <div className="flex flex-wrap gap-2.5">
                <input
                  ref={input}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    void onPick(event);
                  }}
                  data-testid="photo-input"
                />
                <Button
                  variant="secondary"
                  onClick={() => input.current?.click()}
                  disabled={!props.live || saving || removing}
                  data-testid="photo-upload"
                >
                  <Icon name="upload" />
                  {hasPhoto ? labels.replace : labels.upload}
                </Button>
                {hasPhoto ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRemoveOpen(true);
                    }}
                    disabled={!props.live || saving || removing}
                    data-testid="photo-remove"
                  >
                    <Icon name="trash" />
                    {labels.remove}
                  </Button>
                ) : null}
              </div>
              <p className="m-0 text-[13.5px] text-text-muted">{labels.rules}</p>
              {hasPhoto ? null : (
                <p className="m-0 text-[13.5px] text-text-muted">{labels.noPhoto}</p>
              )}
            </div>
          </div>
        </div>
      </FormSection>

      <PhotoCropDialog
        file={file}
        labels={props.crop}
        saving={saving}
        error={saveError}
        onCancel={closeCrop}
        onSave={(blob) => {
          void save(blob);
        }}
      />

      <Dialog
        open={removeOpen}
        onClose={() => {
          setRemoveOpen(false);
        }}
        title={labels.removeTitle}
        description={labels.removeText}
        closeLabel={labels.close}
        tone="warning"
        canClose={() => !removing}
        data-testid="photo-remove-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRemoveOpen(false);
              }}
              disabled={removing}
            >
              {labels.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void remove();
              }}
              busy={removing}
              data-testid="photo-remove-confirm"
            >
              {labels.removeConfirm}
            </Button>
          </>
        }
      />
    </>
  );
}
