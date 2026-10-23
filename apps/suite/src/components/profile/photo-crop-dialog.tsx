'use client';
import { Alert, Button, Dialog } from '@jadarat/ui';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  CENTERED,
  type Framing,
  MAX_PHOTO_BYTES,
  MAX_ZOOM,
  MIN_ZOOM,
  OUTPUT_SIDE,
  baseScale,
  clampFraming,
  formatBytes,
  moveBy,
  sourceRect,
  zoomTo,
} from '../../lib/profile-photo-crop';

/** The view's side in CSS pixels; the canvas is drawn at twice that for sharpness. */
const VIEW = 288;
const PIXELS = VIEW * 2;

export interface PhotoCropLabels {
  readonly title: string;
  readonly help: string;
  readonly area: string;
  /** How to use the keyboard on the area (read after its name; aria-describedby). */
  readonly keys: string;
  readonly zoom: string;
  /** «{file} · shrunk from {from} to {to}». */
  readonly shrunk: string;
  readonly save: string;
  readonly saving: string;
  readonly cancel: string;
  readonly close: string;
  readonly errType: string;
  readonly errSize: string;
  readonly errLoad: string;
}

export interface PhotoCropDialogProps {
  readonly file: File | null;
  readonly labels: PhotoCropLabels;
  /** Saving is running (the upload and the save): the dialog cannot be closed meanwhile. */
  readonly saving: boolean;
  /** The server's refusal of the last save, shown in the dialog. */
  readonly error: string | null;
  readonly onCancel: () => void;
  /** The framed picture, shrunk to a JPEG square. */
  readonly onSave: (blob: Blob) => void;
}

interface Loaded {
  readonly bitmap: ImageBitmap | HTMLImageElement;
  readonly width: number;
  readonly height: number;
}

async function decode(file: File): Promise<Loaded> {
  // The browser applies the EXIF orientation when it decodes; the saved copy is re-encoded without EXIF.
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { bitmap: image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The framed square as a JPEG that fits the 2 MB limit (the quality steps down if it ever needs to). */
async function encode(loaded: Loaded, framing: Framing): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIDE;
  canvas.height = OUTPUT_SIDE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const { sx, sy, side } = sourceRect(framing, loaded.width, loaded.height, VIEW);
  // White under any transparency (JPEG has none).
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, OUTPUT_SIDE, OUTPUT_SIDE);
  context.imageSmoothingQuality = 'high';
  context.drawImage(loaded.bitmap, sx, sy, side, side, 0, 0, OUTPUT_SIDE, OUTPUT_SIDE);
  for (const quality of [0.9, 0.8, 0.6, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (blob && blob.size <= MAX_PHOTO_BYTES) return blob;
  }
  return null;
}

/**
 * «Adjust your photo» (WP-ADM-04, design S04-2): a square view onto the chosen picture that is dragged
 * (mouse, finger, or the arrow keys on the focused area) and zoomed (slider); the circle shows what people
 * will see. The picture is drawn on a canvas — no inline styles. Saving shrinks the framed square to a small
 * JPEG in the browser, which also drops every hidden detail (the server removes them again from whatever
 * arrives). The dialog cannot be closed while saving. Each picked file gets a fresh body (its own state).
 */
export function PhotoCropDialog({
  file,
  labels,
  saving,
  error,
  onCancel,
  onSave,
}: PhotoCropDialogProps) {
  return (
    <Dialog
      open={file !== null}
      onClose={onCancel}
      title={labels.title}
      description={labels.help}
      closeLabel={labels.close}
      canClose={() => !saving}
      data-testid="photo-crop-dialog"
    >
      {file ? (
        <CropBody
          key={`${file.name}:${String(file.size)}:${String(file.lastModified)}`}
          file={file}
          labels={labels}
          saving={saving}
          error={error}
          onCancel={onCancel}
          onSave={onSave}
        />
      ) : null}
    </Dialog>
  );
}

function CropBody({
  file,
  labels,
  saving,
  error,
  onCancel,
  onSave,
}: Omit<PhotoCropDialogProps, 'file'> & { readonly file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysId = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [framing, setFraming] = useState<Framing>(CENTERED);
  const [shrunkTo, setShrunkTo] = useState<number | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  // Decode the picked file.
  useEffect(() => {
    let cancelled = false;
    decode(file).then(
      (result) => {
        if (!cancelled) setLoaded(result);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file]);

  // The size after shrinking (for the note), from the centred framing.
  useEffect(() => {
    if (loaded === null) return undefined;
    let cancelled = false;
    void encode(loaded, CENTERED).then((blob) => {
      if (!cancelled && blob) setShrunkTo(blob.size);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  // Draw: the picture, then the dimmed corners around the circle the avatar shows.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || loaded === null) return;
    const f = clampFraming(framing, loaded.width, loaded.height, VIEW);
    const scale = baseScale(loaded.width, loaded.height, VIEW) * f.zoom * 2;
    context.clearRect(0, 0, PIXELS, PIXELS);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, PIXELS, PIXELS);
    context.drawImage(
      loaded.bitmap,
      PIXELS / 2 + f.x * 2 - (loaded.width * scale) / 2,
      PIXELS / 2 + f.y * 2 - (loaded.height * scale) / 2,
      loaded.width * scale,
      loaded.height * scale,
    );
    context.save();
    context.beginPath();
    context.rect(0, 0, PIXELS, PIXELS);
    context.arc(PIXELS / 2, PIXELS / 2, PIXELS / 2 - 8, 0, Math.PI * 2, true);
    context.fillStyle = 'rgba(15, 23, 42, 0.5)';
    context.fill('evenodd');
    context.restore();
    context.beginPath();
    context.arc(PIXELS / 2, PIXELS / 2, PIXELS / 2 - 8, 0, Math.PI * 2);
    context.lineWidth = 3;
    context.strokeStyle = '#ffffff';
    context.stroke();
  }, [loaded, framing]);

  const move = useCallback(
    (dx: number, dy: number) => {
      if (loaded === null) return;
      setFraming((current) => moveBy(current, dx, dy, loaded.width, loaded.height, VIEW));
    },
    [loaded],
  );

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (loaded === null || saving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    // Client pixels → view pixels (the canvas shrinks on a very narrow screen).
    const ratio = VIEW / Math.max(event.currentTarget.clientWidth, 1);
    move((event.clientX - current.x) * ratio, (event.clientY - current.y) * ratio);
    drag.current = { id: current.id, x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }
  function onKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    const step = event.shiftKey ? 32 : 8;
    // The picture moves the way the key points ON SCREEN, in Arabic (right-to-left) as in English: the canvas
    // is a picture, not text, and is never mirrored, so ArrowLeft always moves the picture to the user's left
    // (the same direction as dragging it) - security review L5.
    const keys: Record<string, readonly [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = keys[event.key];
    if (!delta) return;
    event.preventDefault();
    move(delta[0], delta[1]);
  }

  async function save() {
    if (loaded === null || saving) return;
    const blob = await encode(loaded, framing);
    if (blob) onSave(blob);
  }

  const note =
    shrunkTo === null
      ? null
      : labels.shrunk
          .replace('{file}', file.name)
          .replace('{from}', formatBytes(file.size))
          .replace('{to}', formatBytes(shrunkTo));

  return (
    <div className="flex flex-col items-center gap-4">
      {loadFailed ? <Alert tone="danger">{labels.errLoad}</Alert> : null}
      {error ? (
        <Alert tone="danger" data-testid="photo-save-error">
          {error}
        </Alert>
      ) : null}
      <canvas
        ref={canvasRef}
        width={PIXELS}
        height={PIXELS}
        tabIndex={0}
        // A custom widget: the arrow keys move the picture (named by its label; WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role
        role="application"
        aria-label={labels.area}
        aria-describedby={keysId}
        className="size-72 max-w-full touch-none rounded-lg border border-border bg-surface-sunken outline-offset-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        data-testid="photo-crop-area"
      />
      <span id={keysId} className="sr-only">
        {labels.keys}
      </span>
      <label className="flex w-full max-w-72 flex-col gap-1.5 text-sm font-semibold">
        {labels.zoom}
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={framing.zoom}
          disabled={loaded === null || saving}
          onChange={(event) => {
            if (loaded === null) return;
            const value = Number(event.currentTarget.value);
            setFraming((current) => zoomTo(current, value, loaded.width, loaded.height, VIEW));
          }}
          data-testid="photo-zoom"
        />
      </label>
      {note ? (
        <p className="m-0 text-center text-[13.5px] text-text-muted" data-testid="photo-shrunk">
          <bdi>{note}</bdi>
        </p>
      ) : null}
      <div className="flex w-full flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {labels.cancel}
        </Button>
        <Button
          onClick={() => {
            void save();
          }}
          busy={saving}
          disabled={loaded === null || saving}
          data-testid="photo-save"
        >
          {saving ? labels.saving : labels.save}
        </Button>
      </div>
    </div>
  );
}
