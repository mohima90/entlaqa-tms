/**
 * One image slot of the Branding page (WP-ADM-02; security review M3): what the slot shows and which file
 * a save would keep, through a pick → upload → save. A failed REPLACEMENT never loses the image the slot
 * had: the slot remembers it (`previous`) when a new file is picked and puts it back on any failure —
 * start, upload or confirmation refused, or the save refusing the image (wrong type by content, too large,
 * too many pixels, damaged). Branding images are not virus-scanned (PO, 20 Oct 2026): the save checks and
 * publishes them, so there is no scan to wait for. Pure state transitions (the form holds them in React
 * state), so every path is unit-tested.
 */

export type SlotPhase = 'none' | 'saved' | 'uploading' | 'ready' | 'previewOnly';

/** What a slot shows and keeps. */
export interface SlotImage {
  readonly fileId: string | null;
  /** What the previews show: the published copy, or the picked file (blob:). */
  readonly src: string | null;
  readonly name: string | null;
  readonly phase: SlotPhase;
}

export interface SlotState extends SlotImage {
  readonly error: string | null;
  /** The saved image cannot be used (the worker gave up publishing it): the page asks for another. */
  readonly failed: boolean;
  /** The image before the pick in progress, put back if the pick fails (null: nothing to put back). */
  readonly previous: SlotImage | null;
}

export const EMPTY_SLOT: SlotState = {
  fileId: null,
  src: null,
  name: null,
  phase: 'none',
  error: null,
  failed: false,
  previous: null,
};

export interface SavedImage {
  readonly fileId: string;
  readonly src: string | null;
  readonly name: string | null;
  readonly failed?: boolean;
}

/** The slot as loaded: the saved image, or empty. */
export function initialSlot(image: SavedImage | null): SlotState {
  if (!image) return EMPTY_SLOT;
  return {
    ...EMPTY_SLOT,
    fileId: image.fileId,
    src: image.src,
    name: image.name,
    phase: 'saved',
    failed: image.failed === true,
  };
}

const inProgress = (phase: SlotPhase) => phase === 'uploading';

function snapshot(state: SlotState): SlotImage | null {
  if (state.fileId === null && state.src === null) return null;
  return { fileId: state.fileId, src: state.src, name: state.name, phase: state.phase };
}

/**
 * A file was picked and passed the browser's checks: the previews show it at once. The image to put back is
 * the one the slot had — or, when a pick was still uploading or waiting for the save, the one before that
 * pick. The slot keeps the old file id until the new upload is confirmed (a save meanwhile keeps the old
 * image).
 */
export function beginPick(
  state: SlotState,
  picked: { readonly src: string; readonly name: string },
  phase: 'uploading' | 'previewOnly',
): SlotState {
  const replacing = inProgress(state.phase) || state.phase === 'ready';
  const previous = replacing ? state.previous : snapshot(state);
  const keptFileId = replacing ? (previous?.fileId ?? null) : state.fileId;
  return {
    fileId: phase === 'uploading' ? keptFileId : state.fileId,
    src: picked.src,
    name: picked.name,
    phase,
    error: null,
    failed: false,
    previous,
  };
}

/** The pick failed (any step): the image before it is back, with the reason. */
export function pickFailed(state: SlotState, error: string): SlotState {
  const back = state.previous;
  if (!back) return { ...EMPTY_SLOT, error };
  return { ...EMPTY_SLOT, ...back, error };
}

/** Is the slot still uploading the file picked as `src` (not removed or replaced meanwhile)? */
const uploading = (state: SlotState, src: string) =>
  state.phase === 'uploading' && state.src === src;

/** Starting, sending or confirming the upload of `src` failed: the image before the pick is back. */
export function uploadFailed(state: SlotState, src: string, error: string): SlotState {
  return uploading(state, src) ? pickFailed(state, error) : state;
}

/**
 * The upload of `src` was confirmed: the slot keeps the new file, ready to be saved (the save checks and
 * publishes it; until then the image before the pick can still be put back). Ignored when the slot moved on
 * meanwhile.
 */
export function uploadConfirmed(state: SlotState, src: string, fileId: string): SlotState {
  if (!uploading(state, src)) return state;
  return { ...state, fileId, phase: 'ready', error: null };
}

/**
 * The save refused this slot's image (its reason): a new image gives way to the one before the pick; a
 * saved one keeps showing, with the reason.
 */
export function saveRefused(state: SlotState, error: string): SlotState {
  return state.phase === 'ready' ? pickFailed(state, error) : { ...state, error };
}

/** Removed by the admin: nothing to put back (a save removes the saved image). */
export function removed(): SlotState {
  return EMPTY_SLOT;
}

/**
 * After a successful save: what the slot holds is now the saved image (published by the save) — the image
 * before the pick was released, nothing to put back any more.
 */
export function afterSave(state: SlotState): SlotState {
  const phase = state.phase === 'ready' ? 'saved' : state.phase;
  return { ...state, phase, previous: null, failed: state.failed && state.phase === 'saved' };
}
