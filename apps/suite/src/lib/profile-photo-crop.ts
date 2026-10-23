/**
 * Framing of a profile photo in the browser (WP-ADM-04, S04-2 «Adjust your photo»): a square view onto the
 * picture, which the member drags and zooms; the square is what is saved (the avatar's circle or rounded
 * square is only CSS). Pure geometry, so every path is unit-tested; the dialog holds the state.
 *
 * Coordinates: the view is `view` x `view` pixels. The picture is drawn at `scale = baseScale * zoom` with
 * its centre at (view / 2 + x, view / 2 + y). It always covers the whole view (no empty border).
 */

/** The smallest and largest zoom (1 = the picture just covers the view). */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** The saved picture's side in pixels (a profile photo is small: ~60 KB as JPEG). */
export const OUTPUT_SIDE = 512;

/** The server's limit: 2 MB after shrinking. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export interface Framing {
  readonly zoom: number;
  /** Offset of the picture's centre from the view's centre, in view pixels. */
  readonly x: number;
  readonly y: number;
}

export const CENTERED: Framing = { zoom: MIN_ZOOM, x: 0, y: 0 };

/** The scale at which the picture just covers the view. */
export function baseScale(width: number, height: number, view: number): number {
  return Math.max(view / width, view / height);
}

/** Keeps the zoom in range and the picture covering the view. */
export function clampFraming(
  framing: Framing,
  width: number,
  height: number,
  view: number,
): Framing {
  const zoom = Math.min(Math.max(framing.zoom, MIN_ZOOM), MAX_ZOOM);
  const scale = baseScale(width, height, view) * zoom;
  const maxX = Math.max((width * scale - view) / 2, 0);
  const maxY = Math.max((height * scale - view) / 2, 0);
  return {
    zoom,
    x: Math.min(Math.max(framing.x, -maxX), maxX),
    y: Math.min(Math.max(framing.y, -maxY), maxY),
  };
}

/** Moves the picture by (dx, dy) view pixels (a drag or the arrow keys). */
export function moveBy(
  framing: Framing,
  dx: number,
  dy: number,
  width: number,
  height: number,
  view: number,
): Framing {
  return clampFraming({ ...framing, x: framing.x + dx, y: framing.y + dy }, width, height, view);
}

/** Changes the zoom around the view's centre (the picture's offset scales with it). */
export function zoomTo(
  framing: Framing,
  zoom: number,
  width: number,
  height: number,
  view: number,
): Framing {
  const next = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
  const ratio = framing.zoom === 0 ? 1 : next / framing.zoom;
  return clampFraming(
    { zoom: next, x: framing.x * ratio, y: framing.y * ratio },
    width,
    height,
    view,
  );
}

/** The part of the picture (in its own pixels) that the view shows: what is saved. */
export function sourceRect(
  framing: Framing,
  width: number,
  height: number,
  view: number,
): { readonly sx: number; readonly sy: number; readonly side: number } {
  const f = clampFraming(framing, width, height, view);
  const scale = baseScale(width, height, view) * f.zoom;
  const side = view / scale;
  return {
    sx: width / 2 - f.x / scale - side / 2,
    sy: height / 2 - f.y / scale - side / 2,
    side,
  };
}

/** «1.8 MB», «640 KB»: sizes as the shrink note shows them (Latin digits). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}

/** The refusal key the card shows for a failed pick, or null: PNG/JPEG/WebP only, checked by content. */
export type PhotoPickProblem = 'type' | 'size';

/**
 * Before anything is loaded: a file that is not PNG/JPEG/WebP by its first bytes is refused (SVG and GIF
 * included — the server checks again by content). A very large file is refused here too (it cannot be
 * decoded safely): 25 MB; ordinary phone photos are shrunk by the framing step.
 */
export const MAX_PICK_BYTES = 25 * 1024 * 1024;

export function pickProblem(
  type: 'image/png' | 'image/jpeg' | 'image/webp' | null,
  size: number,
): PhotoPickProblem | null {
  if (type === null || size < 1) return 'type';
  if (size > MAX_PICK_BYTES) return 'size';
  return null;
}
