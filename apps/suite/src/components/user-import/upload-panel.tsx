'use client';
import { Alert, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { confirmUserImportUploadAction, startUserImportAction } from '../../actions/user-import';
import { fillText } from '../../lib/fill-text';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

/** The largest upload (20 MB) and the types a file may be (by its extension; the scan checks content). */
const MAX_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = ['.csv', '.xlsx'];

export interface UploadPanelProps {
  /** Where the import continues: `${importBase}/${importId}`. */
  readonly importBase: string;
  /** Texts of namespace `userImport.upload` and `userImport.fileStates` (keys below). */
  readonly labels: Readonly<Record<string, string>>;
  /** Refusal texts by code (`userImport.fileStates.uploadErrors`). */
  readonly codes: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: string;
}

type Phase =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'uploading';
      readonly name: string;
      readonly loaded: number;
      readonly total: number;
    }
  | { readonly kind: 'cut' };

function megabytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(`${locale === 'en' ? 'en' : 'ar'}-u-nu-latn`, {
    maximumFractionDigits: 1,
  }).format(bytes / (1024 * 1024));
}

/**
 * Step 1 «رفع الملف» (approved screens 2 and 4): a real «اختيار ملف» button (drag and drop is an extra),
 * the browser's PUT straight to private storage with a signed URL and a progress bar, «إيقاف الرفع»;
 * then the import page follows the virus scan and the reading. Phase changes are announced once each.
 */
export function UploadPanel({ importBase, labels, codes, errors, locale }: UploadPanelProps) {
  const text = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [failure, setFailure] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [dragging, setDragging] = useState(false);

  const refuse = (code: string, fallback?: string) => {
    setPhase({ kind: 'idle' });
    setFailure(codes[code] ?? fallback ?? code);
  };

  const put = (url: string, contentType: string, file: File) =>
    new Promise<'done' | 'cut' | 'aborted'>((resolve) => {
      const request = new XMLHttpRequest();
      xhr.current = request;
      request.open('PUT', url);
      request.setRequestHeader('Content-Type', contentType);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setPhase({
            kind: 'uploading',
            name: file.name,
            loaded: event.loaded,
            total: event.total,
          });
        }
      };
      request.onload = () => {
        resolve(request.status >= 200 && request.status < 300 ? 'done' : 'cut');
      };
      request.onerror = () => {
        resolve('cut');
      };
      request.onabort = () => {
        resolve('aborted');
      };
      request.send(file);
    });

  const upload = async (file: File) => {
    setFailure(null);
    const lower = file.name.toLowerCase();
    if (!EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      refuse('TYPE_NOT_ALLOWED');
      return;
    }
    if (file.size < 1) {
      refuse('EMPTY', text('emptyFile'));
      return;
    }
    if (file.size > MAX_BYTES) {
      refuse('TOO_LARGE');
      return;
    }
    setPhase({ kind: 'uploading', name: file.name, loaded: 0, total: file.size });
    setAnnouncement(text('announceStart'));
    const started = await startUserImportAction({ fileName: file.name, size: file.size });
    if (!started.ok) {
      const code = fieldErrorCodes(started.error).file;
      refuse(code ?? '', errorText(started.error, errors));
      return;
    }
    const outcome = await put(started.value.upload.url, started.value.upload.contentType, file);
    xhr.current = null;
    if (outcome === 'aborted') {
      setPhase({ kind: 'idle' });
      return;
    }
    if (outcome === 'cut') {
      setPhase({ kind: 'cut' });
      return;
    }
    const confirmed = await confirmUserImportUploadAction({ importId: started.value.importId });
    if (!confirmed.ok) {
      const code = fieldErrorCodes(confirmed.error).file;
      refuse(code ?? '', errorText(confirmed.error, errors));
      return;
    }
    setAnnouncement(text('announceDone'));
    router.push(`${importBase}/${started.value.importId}`);
  };

  const choose = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void upload(file);
  };

  // Drag and drop is an extra for pointer users (the «اختيار ملف» button is the accessible way), so its
  // listeners are attached to the drop zone directly rather than making the zone an interactive element.
  const zone = useRef<HTMLDivElement>(null);
  const dropFile = useRef(choose);
  useEffect(() => {
    dropFile.current = choose;
  });
  const idle = phase.kind === 'idle';
  useEffect(() => {
    const element = zone.current;
    if (!element) return;
    const over = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    };
    const leave = () => {
      setDragging(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      dropFile.current(event.dataTransfer?.files ?? null);
    };
    element.addEventListener('dragover', over);
    element.addEventListener('dragleave', leave);
    element.addEventListener('drop', drop);
    return () => {
      element.removeEventListener('dragover', over);
      element.removeEventListener('dragleave', leave);
      element.removeEventListener('drop', drop);
    };
  }, [idle]);

  const percent =
    phase.kind === 'uploading' && phase.total > 0
      ? Math.min(100, Math.round((phase.loaded / phase.total) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-3" data-testid="upload-panel">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {failure ? (
        <Alert tone="danger" data-testid="upload-error">
          {failure}
        </Alert>
      ) : null}
      {phase.kind === 'uploading' ? (
        <div className="rounded-lg border border-border p-4" data-testid="upload-progress">
          <p className="m-0 font-medium">
            <bdi>{phase.name}</bdi>
          </p>
          <p className="m-0 text-sm text-text-muted">
            {fillText(
              text('uploaded'),
              {
                loaded: megabytes(phase.loaded, locale),
                total: `${megabytes(phase.total, locale)} ${text('mbUnit')}`,
              },
              locale,
            )}
          </p>
          <p className="mb-1 mt-2">{text('uploading')}</p>
          <div
            role="progressbar"
            aria-label={text('progressLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${String(percent)}%`}
            className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
          >
            <div className="h-full bg-primary" style={{ inlineSize: `${String(percent)}%` }} />
          </div>
          <p className="mb-0 mt-1 text-sm text-text-muted">
            {fillText(text('percent'), { percent }, locale)}
          </p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              xhr.current?.abort();
            }}
          >
            {text('cancelUpload')}
          </Button>
        </div>
      ) : phase.kind === 'cut' ? (
        <Alert tone="warning" title={text('cutTitle')} data-testid="upload-cut">
          <p className="m-0">{text('cutBody')}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              setPhase({ kind: 'idle' });
              input.current?.click();
            }}
          >
            {text('cutRetry')}
          </Button>
        </Alert>
      ) : (
        <div
          ref={zone}
          className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center ${
            dragging ? 'border-primary bg-surface-selected' : 'border-border-strong'
          }`}
        >
          <p className="m-0">{text('dropHint')}</p>
          <Button
            variant="primary"
            onClick={() => input.current?.click()}
            data-testid="choose-file"
          >
            {text('choose')}
          </Button>
          <p className="m-0 text-sm text-text-muted">{text('limits')}</p>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="import-file-input"
        onChange={(event) => {
          choose(event.target.files);
          event.target.value = '';
        }}
      />
      <ul className="m-0 flex flex-col gap-1 ps-5 text-sm text-text-muted">
        <li>{text('rowsHint')}</li>
        <li>{text('scanHint')}</li>
        <li>{text('retentionHint')}</li>
      </ul>
    </div>
  );
}
